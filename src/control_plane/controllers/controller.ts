import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { ControlPlane } from '../control_plane';
import { Delta } from '../capacity_manager';
import { ControlPanelEvent } from '#self/lib/constants';
import { ContainerManager } from '../container/container_manager';

export class BaseController {
  logger: Logger;
  shrinking: boolean;
  containerManager: ContainerManager;

  constructor(public plane: ControlPlane) {
    this.logger = loggers.get('base controller');
    this.shrinking = false;
    this.containerManager = plane.containerManager;
  }
  /**
   * Expand.
   * @param {Delta[]} deltas Broker and its processes delta number.
   * @param {import('./worker_stats/broker').Broker[]} brokers Each broker.
   * @return {Promise<void>} The result.
   */
  async expand(deltas: Delta[]) {
    const expansions = [];
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i];
      if (deltas[i].count > 0) {
        const profile = this.plane.functionProfile.get(delta.broker.name);
        const toReserve =
          delta.broker.workerCount < delta.broker.reservationCount;
        expansions.push(
          this.tryBatchLaunch(
            delta.broker.name,
            delta.count,
            {
              inspect: delta.broker.isInspector,
            },
            profile?.worker?.disposable || false,
            toReserve
          )
        );
      }
    }
    await Promise.all(expansions);
  }
  /**
   * Try batchLaunch
   * @param {string} functionName The function name.
   * @param {number} count How many processes would be started.
   * @param {{ inspect?: boolean }} options The options.
   * @return {Promise<undefined[]>} The result.
   */
  async tryBatchLaunch(
    functionName: string,
    count: number,
    options: ExpansionOptions,
    disposable = false,
    toReserve = false
  ): Promise<void[]> {
    const { workerLauncher } = this.plane;
    const ret = [];
    for (let i = 0; i < count; i++) {
      ret.push(
        workerLauncher.tryLaunch(
          ControlPanelEvent.Expand,
          functionName,
          options,
          disposable,
          toReserve
        )
      );
    }
    return Promise.all(ret);
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
        const realWorker =
          this.plane.capacityManager.workerStatsSnapshot.getWorker(
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
  /**
   * Destory worker.
   * @param {string} workerName The worker name to be destroyed.
   * @return {Promise<void>} The result.
   */
  async stopWorker(workerName: string, requestId?: string) {
    const container = this.containerManager.getContainer(workerName);
    if (container == null) {
      return;
    }
    await container.stop();
    this.logger.info(
      'worker(%s) with request(%s) stopped.',
      workerName,
      requestId
    );
  }
  /**
   * Force dismiss all workers in certain brokers.
   * @param {string[]} names The broker names.
   * @return {Promise<void>} The result.
   */
  async stopAllWorkers(names: string[]) {
    if (names.length === 0) {
      return;
    }

    const { workerStatsSnapshot } = this.plane.capacityManager;
    const promises = [];
    this.logger.info('stop all worker of function %j', names);
    for (const name of names) {
      const brokers = [
        workerStatsSnapshot.getBroker(name, false),
        workerStatsSnapshot.getBroker(name, true),
      ];
      for (const broker of brokers) {
        if (!broker) continue;
        const { workers } = broker;
        for (const workerName of workers.keys()) {
          promises.push(this.stopWorker(workerName));
        }
      }
    }
    const results = await Promise.allSettled(promises);
    for (const ret of results) {
      if (ret.status === 'rejected') {
        this.logger.warn('Failed to force stop all workers.', ret.reason);
      }
    }
  }
}

interface ExpansionOptions {
  inspect?: boolean;
}
