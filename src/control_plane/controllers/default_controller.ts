import _ from 'lodash';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { ControlPlane } from '../control_plane';
import { Delta } from '../capacity_manager';
import { ControlPanelEvent } from '#self/lib/constants';
import { ContainerManager } from '../container/container_manager';
import { RequestQueueingEvent, WorkerTrafficStatsEvent } from '../events';
import {
  ErrorCode,
  wrapLaunchErrorObject,
} from '../worker_launcher_error_code';
import { BaseController } from './base_controller';
import { Config } from '#self/config';
import { WorkerInitData } from '../worker_stats';

export class DefaultController extends BaseController {
  logger: Logger;
  shrinking: boolean;
  containerManager: ContainerManager;

  constructor(plane: ControlPlane, private config: Config) {
    super(plane);
    this.logger = loggers.get('default controller');
    this.shrinking = false;
    this.containerManager = plane.containerManager;

    const eventBus = plane.eventBus;
    eventBus.subscribe(RequestQueueingEvent, {
      next: event => {
        return this.expandDueToQueueingRequest(event);
      },
    });
    eventBus.subscribe(WorkerTrafficStatsEvent, {
      next: event => {
        return this.autoScale();
      },
    });
  }

  /**
   * Expend due to queueing request
   */
  private async expandDueToQueueingRequest(event: RequestQueueingEvent) {
    const { requestId, name, isInspect, stats } = event.data;
    const { brokers = [] } = stats || {};

    this.logger.info(
      'start processing request queueing request(%s) for func(%s, inspect %s)',
      requestId,
      name,
      isInspect
    );

    if (!this.plane.capacityManager.allowExpandingOnRequestQueueing(event)) {
      return;
    }

    const profile = this.plane.functionProfile.get(name);
    if (!profile) {
      const err = new Error(`No function named ${name}.`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const workerInitData = new WorkerInitData(
      profile.name,
      { inspect: false },
      !!profile.worker?.disposable,
      false
    );

    try {
      const now = performance.now();

      await this.plane.workerLauncher.tryLaunch(
        ControlPanelEvent.RequestQueueExpand,
        workerInitData
      );
      this.logger.info(
        'Request(%s) queueing for func(%s, inspect %s) expanded, cost: %sms.',
        requestId,
        name,
        isInspect,
        performance.now() - now
      );
    } catch (e) {
      this.logger.warn(
        'Request(%s) queueing for func(%s, inspect %s) expanding failed.',
        requestId,
        name,
        isInspect,
        e
      );

      event.client
        .startWorkerFastFail(wrapLaunchErrorObject(name, isInspect, e as Error))
        .catch((e: unknown) => {
          this.logger.warn(e);
        });
    }

    this.logger.debug('sync worker data after launch worker(%s)', name);
    // update current workers data
    try {
      if (brokers) {
        await this.plane.stateManager.syncWorkerData(brokers);
      }
    } catch (e) {
      this.logger.warn('Failed to sync data.', e);
    }
    this.logger.debug('worker data synchronized after launch worker(%s)', name);
  }

  private async autoScale() {
    const brokers = [...this.plane.stateManager.brokers()];
    const { expandDeltas, shrinkDeltas } =
      this.plane.capacityManager.evaluteScaleDeltas(brokers);

    const { true: reservationDeltas = [], false: regularDeltas = [] } =
      _.groupBy(
        expandDeltas,
        delta => delta.broker.workerCount < delta.broker.reservationCount
      );

    const errors = [];

    try {
      await this.shrink(shrinkDeltas);
    } catch (e) {
      errors.push(e);
    }

    try {
      await Promise.all([
        this.expand(regularDeltas),
        this.plane.reservationController.expand(reservationDeltas),
      ]);
    } catch (e) {
      errors.push(e);
    }

    if (errors.length) {
      throw errors[0];
    }
  }

  /**
   * Shrink.
   * @param {Delta[]} deltas Broker and its processes delta number.
   * @param {import('./worker_stats_snapshot').Broker[]} brokers Each broker
   * @return {Promise<void>} The result.
   */
  async shrink(deltas: Delta[]) {
    if (this.shrinking) {
      return;
    }
    this.shrinking = true;
    try {
      await this.doShrink(deltas);
    } finally {
      this.shrinking = false;
    }
  }
  /**
   * Do shrink.
   * @param {Delta[]} deltas Broker and its processes delta number.
   * @param {import('./worker_stats/broker').Broker[]} brokers Each broker
   * @return {Promise<undefined[]>} The result.
   */
  async doShrink(deltas: Delta[]) {
    const shrinkData = [];
    for (let i = 0; i < deltas.length; i++) {
      const { count, broker } = deltas[i];
      if (count >= 0) continue;
      // inspect 模式不缩容
      if (broker.isInspector) {
        continue;
      }
      // disposable 模式不缩容
      if (broker.disposable) {
        continue;
      }
      const workers = broker.shrinkDraw(Math.abs(count));
      shrinkData.push({
        functionName: broker.name,
        inspector: broker.isInspector,
        workers,
      });
      this.logger.info(
        `[Auto Scale] Up to shrink ${workers.length} workers in ${broker.name}. ` +
          `waterlevel: ${broker.activeRequestCount}/${broker.totalMaxActivateRequests}, ` +
          `existing: ${!!broker.data}, reservation: ${
            broker.reservationCount
          }, current: ${broker.workerCount}.`
      );
    }
    if (!shrinkData.length) return; // To avoid unneccessary logic below.
    const { dataPlaneClientManager } = this.plane;
    const ensured = await dataPlaneClientManager.reduceCapacity({
      brokers: shrinkData,
    });
    if (!ensured || !ensured.length) {
      return;
    }
    const kill = [];
    const up = [];
    for (const broker of ensured) {
      for (const worker of broker?.workers || []) {
        const realWorker = this.plane.stateManager.getWorker(
          broker.functionName!,
          broker.inspector!,
          worker.name!
        );
        if (realWorker?.credential !== worker.credential) continue;
        up.push(worker.name);
        kill.push(this.stopWorker(worker.name!));
      }
    }
    this.logger.info(
      'Up to do shrink destroy after asking for data plane.',
      up
    );
    await Promise.all(kill);
  }
}
