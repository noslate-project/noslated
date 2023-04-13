import _ from 'lodash';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { ControlPlaneEvent } from '#self/lib/constants';
import { CapacityManager, Delta } from '../capacity_manager';
import { RequestQueueingEvent, WorkerTrafficStatsEvent } from '../events';
import {
  ErrorCode,
  LauncherError,
  wrapLaunchErrorObject,
} from '../worker_launcher_error_code';
import { BaseController } from './base_controller';
import { Broker } from '../worker_stats/broker';
import { Worker, WorkerMetadata } from '../worker_stats/worker';
import { ControlPlaneDependencyContext } from '../deps';
import { DataPlaneClientManager } from '../data_plane_client/manager';
import { ReservationController } from './reservation_controller';

export class DefaultController extends BaseController {
  protected logger: Logger;

  private shrinking: boolean;
  private _capacityManager: CapacityManager;
  private _reservationController: ReservationController;
  private _dataPlaneClientManager: DataPlaneClientManager;

  constructor(ctx: ControlPlaneDependencyContext) {
    super(ctx);
    this._capacityManager = ctx.getInstance('capacityManager');
    this._reservationController = ctx.getInstance('reservationController');
    this._dataPlaneClientManager = ctx.getInstance('dataPlaneClientManager');

    this.logger = loggers.get('default controller');
    this.shrinking = false;

    const eventBus = ctx.getInstance('eventBus');
    eventBus.subscribe(RequestQueueingEvent, {
      next: event => {
        return this.expandDueToQueueingRequest(event);
      },
    });
    eventBus.subscribe(WorkerTrafficStatsEvent, {
      next: () => {
        return this.autoScale();
      },
    });
  }

  /**
   * Expend due to queueing request
   */
  private async expandDueToQueueingRequest(event: RequestQueueingEvent) {
    const { requestId, name, isInspect } = event.data;

    this.logger.info(
      'start processing request queueing request(%s) for func(%s, inspect %s)',
      requestId,
      name,
      isInspect
    );

    const profile = this._functionProfile.getProfile(name);
    if (!profile) {
      throw new LauncherError(ErrorCode.kNoFunction);
    }

    if (!this._capacityManager.allowExpandingOnRequestQueueing(event.data)) {
      return;
    }

    const workerMetadata = new WorkerMetadata(
      profile.name,
      { inspect: isInspect },
      false
    );

    try {
      await this._workerLauncher.tryLaunch(
        ControlPlaneEvent.RequestQueueExpand,
        workerMetadata
      );
      this.logger.info(
        'Request(%s) queueing for func(%s, inspect %s) expanded, cost: %sms.',
        requestId,
        name,
        isInspect,
        Date.now() - event.data.timestamp
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
        .startWorkerFastFail(wrapLaunchErrorObject(name, isInspect, e))
        .catch((e: unknown) => {
          this.logger.warn(e);
        });
    }
  }

  private async autoScale() {
    // Create reservation workers.
    for (const profile of this._functionProfile.getProfiles()) {
      const reservationCount = profile.worker.reservationCount;
      if (reservationCount === 0) continue;
      this._stateManager.getOrCreateBroker(profile.name, false);
    }

    const brokers = [...this._stateManager.brokers()];
    const { expandDeltas, shrinkDeltas } =
      this._capacityManager.evaluateScaleDeltas(brokers);

    const { true: reservationDeltas = [], false: regularDeltas = [] } =
      _.groupBy(
        expandDeltas,
        delta => delta.broker.activeWorkerCount < delta.broker.reservationCount
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
        this._reservationController.expand(reservationDeltas),
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
   * @param deltas Broker and its processes delta number.
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
   * @param deltas Broker and its processes delta number.
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
      const workers = this.shrinkDraw(broker, Math.abs(count));
      shrinkData.push({
        functionName: broker.name,
        inspector: broker.isInspector,
        workers,
      });
      this.logger.info(
        `[Auto Scale] Up to shrink ${workers.length} workers in ${broker.name}. ` +
          `waterlevel: ${broker.getActiveRequestCount()}/${
            broker.totalMaxActivateRequests
          }, ` +
          `reservation: ${broker.reservationCount}, current: ${broker.activeWorkerCount}.`
      );
    }
    if (!shrinkData.length) return; // To avoid unneccessary logic below.
    const ensured = await this._dataPlaneClientManager.reduceCapacity({
      brokers: shrinkData,
    });
    if (!ensured || !ensured.length) {
      return;
    }
    for (const broker of ensured) {
      for (const worker of broker?.workers || []) {
        const realWorker = this._stateManager.getWorker(
          broker.functionName!,
          broker.inspector!,
          worker.name!
        );
        if (realWorker == null) continue;
        if (realWorker.credential !== worker.credential) continue;

        realWorker.updateWorkerStatusByControlPlaneEvent(
          ControlPlaneEvent.Shrink
        );
      }
    }
  }

  /**
   * Get the most `what` `N` workers.
   * @param n The N.
   * @param compareFn The comparation function.
   * @return The most idle N workers.
   */
  private mostWhatNWorkers(
    broker: Broker,
    n: number,
    compareFn: (a: Worker, b: Worker) => number
  ): { name: string; credential: string }[] {
    const workers = Array.from(broker.workers.values()).filter(w =>
      w.isActive()
    );
    const nWorkers = workers.sort(compareFn).slice(0, n);

    return nWorkers.map(w => ({ name: w.name, credential: w.credential! }));
  }

  /**
   * Get the most idle N workers.
   * @param n The N.
   * @return The most idle N workers.
   */
  mostIdleNWorkers(broker: Broker, n: number) {
    return this.mostWhatNWorkers(broker, n, (a, b) => {
      if (a.data?.activeRequestCount! < b.data?.activeRequestCount!) {
        return -1;
      } else if (a.data?.activeRequestCount! > b.data?.activeRequestCount!) {
        return 1;
      }
      return a.credential! < b.credential! ? -1 : 1;
    });
  }

  /**
   * Get the newest N workers.
   * @param n The N.
   * @return The most idle N workers.
   */
  newestNWorkers(broker: Broker, n: number) {
    return this.mostWhatNWorkers(broker, n, (a, b) => {
      if (a.registerTime > b.registerTime) {
        return -1;
      } else if (a.registerTime < b.registerTime) {
        return 1;
      }
      return a.credential! < b.credential! ? -1 : 1;
    });
  }

  /**
   * Get the oldest N workers.
   * @param n The N.
   * @return The most idle N workers.
   */
  oldestNWorkers(broker: Broker, n: number) {
    return this.mostWhatNWorkers(broker, n, (a, b) => {
      if (a.registerTime < b.registerTime) {
        return -1;
      } else if (a.registerTime > b.registerTime) {
        return 1;
      }
      return a.credential! < b.credential! ? -1 : 1;
    });
  }

  /**
   * Do shrink draw, choose chosen workers.
   * @param countToChoose The count to choose.
   * @return The chosen workers.
   */
  shrinkDraw(broker: Broker, countToChoose: number) {
    const strategy = broker.profile.worker.shrinkStrategy;

    let workers = [];

    switch (strategy) {
      case 'FILO': {
        workers = this.newestNWorkers(broker, countToChoose);
        break;
      }
      case 'FIFO': {
        workers = this.oldestNWorkers(broker, countToChoose);
        break;
      }
      case 'LCC':
      default: {
        if (strategy !== 'LCC') {
          this.logger.warn(
            `Shrink strategy ${strategy} is not supported, fallback to LCC.`
          );
        }

        workers = this.mostIdleNWorkers(broker, countToChoose);
      }
    }

    return workers;
  }
}
