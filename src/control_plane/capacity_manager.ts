import bytes from 'bytes';
import { Base } from '#self/lib/sdk_base';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { TaskQueue } from '#self/lib/task_queue';
import { turf } from '#self/lib/turf';
import { Broker, WorkerStatsSnapshot } from './worker_stats';
import { wrapLaunchErrorObject } from './worker_launcher_error_code';
import { ControlPlane } from './control_plane';
import { Config } from '#self/config';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Turf } from '#self/lib/turf/wrapper';
import { DataPlaneClient } from './data_plane_client/client';
import * as root from '#self/proto/root';
import _ from 'lodash';
import { performance } from 'perf_hooks';
import { NotNullableInterface } from '#self/lib/interfaces';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';

/**
 * CapacityManager
 */
export class CapacityManager extends Base {
  functionProfileManager: FunctionProfileManager
  workerStatsSnapshot: WorkerStatsSnapshot;
  virtualMemoryPoolSize: number;
  shrinking: boolean;
  turf: Turf;
  logger: Logger;
  requestQueueingTasks: TaskQueue<RequestQueueItem>;

  constructor(public plane: ControlPlane, private config: Config) {
    super();

    this.functionProfileManager = plane.functionProfile;
    this.workerStatsSnapshot = new WorkerStatsSnapshot(plane.functionProfile, config);
    this.virtualMemoryPoolSize = bytes(config.virtualMemoryPoolSize);
    this.shrinking = false;
    this.turf = turf;
    this.logger = loggers.get('capacity manager');
    this.requestQueueingTasks = new TaskQueue(1);
  }

  /**
   * Init (override)
   */
  async _init() {
    await this.workerStatsSnapshot.ready();
  }

  /**
   * Close (override)
   */
  async _close() {
    await this.workerStatsSnapshot.close();
  }

  /**
   * Sync worker data
   */
  async syncWorkerData(data: root.noslated.data.IBrokerStats[]) {
    const psData = await turf.ps();

    if (!psData || psData.length === 0) {
      this.logger.warn('got turf ps data empty, skip current syncWorkerData operation.');
      return;
    }

    const timestamp = performance.now();
    this.workerStatsSnapshot.sync(data, psData, timestamp);
    await this.workerStatsSnapshot.correct();
  }

  /**
   * @type {number}
   */
  get virtualMemoryUsed() {
    return [ ...this.workerStatsSnapshot.brokers.values() ].reduce((memo, broker) => (memo + broker.virtualMemory), 0);
  }

  /**
   * Try expansion
   * @param {string} functionName The function name.
   * @param {number} count How many processes would be started.
   * @param {{ inspect?: boolean }} options The options.
   * @return {Promise<undefined[]>} The result.
   */
  async tryExpansion(
    functionName: string,
    count: number,
    options: ExpansionOptions,
    disposable = false,
    toReserve = false
  ): Promise<void[]> {
    const { workerLauncher } = this.plane;
    const ret = [];
    for (let i = 0; i < count; i++) {
      ret.push(workerLauncher.tryLaunch(functionName, options, disposable, toReserve));
    }
    return Promise.all(ret);
  }

  /**
   * Expand.
   * @param {number[]} deltas Each brokers' processes delta number.
   * @param {import('./worker_stats/broker').Broker[]} brokers Each broker.
   * @return {Promise<void>} The result.
   */
  async #expand(deltas: number[], brokers: Broker[]) {
    const memoUsed = this.virtualMemoryUsed;
    const needMemo = deltas.reduce((memo, delta, i) => {
      const broker: Broker = brokers[i];
      return delta > 0 ? memo + delta * broker.memoryLimit : memo;
    }, 0);

    let rate = 1.0;
    if (needMemo + memoUsed > this.virtualMemoryPoolSize) {
      rate = (this.virtualMemoryPoolSize - memoUsed) / needMemo;
      for (let i = 0; i < deltas.length; i++) {
        if (brokers[i].isInspector) {
          // inspect 模式不自动扩容
          deltas[i] = 0;
        } else if (brokers[i].disposable) {
          // 即抛模式不自动扩容
          deltas[i] = 0;
        } else if (deltas[i] > 0) {
          const newDeltas = Math.floor(deltas[i] * rate);

          this.logger.info(
            `[Auto Scale] Up to expand ${Math.max(newDeltas, 0)} workers ${brokers[i].name}. ` +
            `waterlevel: ${brokers[i].activeRequestCount}/${brokers[i].totalMaxActivateRequests}, ` +
            `delta: ${deltas[i]}, memo rate: ${rate}, reservation: ${brokers[i].reservationCount}, ` +
            `current: ${brokers[i].workerCount}.`);

          deltas[i] = newDeltas;
        }
      }
    }

    const expansions = [];
    for (let i = 0; i < deltas.length; i++) {
      if (deltas[i] > 0) {
        const profile = this.plane.functionProfile.get(brokers[i].name);
        const toReserve = brokers[i].workerCount < brokers[i].reservationCount;
        expansions.push(
          this.tryExpansion(
            brokers[i].name,
            deltas[i],
            {
              inspect: brokers[i].isInspector,
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
   * Destory worker.
   * @param {string} workerName The worker name to be destroyed.
   * @return {Promise<void>} The result.
   */
  async stopWorker(workerName: string, requestId?: string) {
    await this.turf.stop(workerName);
    this.logger.info('worker(%s) with request(%s) stopped.', workerName, requestId);
  }

  async updateWorkerContainerStatus(report: NotNullableInterface<root.noslated.data.IContainerStatusReport>) {
    const { functionName, name, event, timestamp, isInspector } = report;

    const broker = this.workerStatsSnapshot.getBroker(functionName, isInspector);
    const worker = this.workerStatsSnapshot.getWorker(functionName, isInspector, name);

    if (broker && worker) {
      worker.updateContainerStatusByEvent(event as ContainerStatusReport, timestamp);

      // 如果已经 ready，则从 starting pool 中移除
      if (worker.containerStatus === ContainerStatus.Ready) {
        broker.removeItemFromStartingPool(worker.name);
      }

      if (event === ContainerStatusReport.RequestDrained && worker.containerStatus === ContainerStatus.Stopped && worker.disposable) {
        // wait next sync to gc worker data and related resources
        const now = performance.now();

        worker.requestId = report.requestId;

        this.stopWorker(worker.name, report.requestId)
          .then(() => {
            this.logger.info(`stop worker [${worker.name}] because container status is [${ContainerStatus[worker.containerStatus]}] and disposable=true, cost: ${performance.now() - now}.`);
          })
          .catch((error) => {
            this.logger.error(`stop worker [${worker.name}] because container status is [${ContainerStatus[worker.containerStatus]}] and disposable=true failed, wait sync to gc, cost: ${performance.now() - now}.`, error);
          });
      }
    } else {
      this.logger.warn('updateWorkerContainerStatus report [%o] skip because no broker and worker related.', report);
    }
  }

  /**
   * Shrink.
   * @param {number[]} deltas Each brokers' processes delta number.
   * @param {import('./worker_stats_snapshot').Broker[]} brokers Each broker
   * @return {Promise<void>} The result.
   */
  async #shrink(deltas: number[], brokers: Broker[]) {
    if (this.shrinking) {
      return;
    }
    this.shrinking = true;

    try {
      await this.#doShrink(deltas, brokers);
    } finally {
      this.shrinking = false;
    }
  }

  /**
   * Do shrink.
   * @param {number[]} deltas Each brokers' processes delta number.
   * @param {import('./worker_stats/broker').Broker[]} brokers Each broker
   * @return {Promise<undefined[]>} The result.
   */
  async #doShrink(deltas: number[], brokers: Broker[]) {
    const shrinkData = [];
    for (let i = 0; i < deltas.length; i++) {
      if (deltas[i] >= 0) continue;

      const broker = brokers[i];

      // inspect 模式不缩容
      if (broker.isInspector) {
        continue;
      }

      // 即抛模式不缩容
      if (broker.disposable) {
        continue;
      }

      const workers = broker.shrinkDraw(Math.abs(deltas[i]));

      shrinkData.push({
        functionName: broker.name,
        inspector: broker.isInspector,
        workers,
      });

      this.logger.info(
        `[Auto Scale] Up to shrink ${workers.length} workers in ${broker.name}. ` +
        `waterlevel: ${broker.activeRequestCount}/${broker.totalMaxActivateRequests}, ` +
        `existing: ${!!broker.data}, reservation: ${broker.reservationCount}, current: ${broker.workerCount}.`);
    }

    if (!shrinkData.length) return; // To avoid unneccessary logic below.

    const { dataPlaneClientManager } = this.plane;
    const ensured = await dataPlaneClientManager.reduceCapacity({ brokers: shrinkData });
    if (!ensured || !ensured.length) {
      return;
    }

    const kill = [];
    const up = [];

    for (const broker of ensured) {
      for (const worker of broker?.workers || []) {
        const realWorker = this.workerStatsSnapshot.getWorker(broker.functionName, broker.inspector, worker.name);
        if (realWorker?.credential !== worker.credential) continue;
        up.push(worker.name);
        kill.push(this.stopWorker(worker.name));
      }
    }

    this.logger.info('Up to do shrink destroy after asking for data plane.', up);
    await Promise.all(kill);
  }

  /**
   * Auto scale.
   * @return {Promise<void>} The result.
   */
  async autoScale() {
    // 先创建 brokers
    const { reservationCountPerFunction } = this.config.worker;
    for (const profile of this.functionProfileManager.profile) {
      const reservationCount = profile?.worker?.reservationCount;
      if (reservationCount === 0) continue;
      if (reservationCount || reservationCountPerFunction) {
        this.workerStatsSnapshot.getOrCreateBroker(profile.name, false, profile.worker?.disposable);
      }
    }

    const brokers = [ ...this.workerStatsSnapshot.brokers.values() ];
    const deltas = brokers.map(broker => broker.evaluateWaterLevel(false));

    // 若扩缩容后小于预留数，则强行扩缩容至预留数。
    for (let i = 0; i < deltas.length; i++) {
      if (brokers[i].workerCount < brokers[i].reservationCount) {
        // 扩容至预留数
        deltas[i] = Math.max(deltas[i], brokers[i].reservationCount - brokers[i].workerCount);
      } else if (brokers[i].workerCount + deltas[i] < brokers[i].reservationCount) {
        // 缩容至预留数
        deltas[i] = brokers[i].reservationCount - brokers[i].workerCount;
      }
    }

    const errors = [];

    try {
      await this.#shrink(deltas, brokers);
    } catch (e) {
      errors.push(e);
    }

    try {
      await this.#expand(deltas, brokers);
    } catch (e) {
      errors.push(e);
    }

    if (errors.length) {
      throw errors[0];
    }
  }

  /**
   * Force dismiss all workers in certain brokers.
   * @param {string[]} names The broker names.
   * @return {Promise<void>} The result.
   */
  async forceDismissAllWorkersInCertainBrokers(names: string[]) {
    if (!Array.isArray(names)) names = [ names ];
    const { workerStatsSnapshot } = this;
    const promises = [];

    this.logger.info('Up to force dismiss all workers in broker', names);
    for (const name of names) {
      const brokers = [ workerStatsSnapshot.getBroker(name, false), workerStatsSnapshot.getBroker(name, true) ];
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
        this.logger.warn('Failed to force dismiss worker.', ret.reason);
      }
    }
    this.logger.info(names, 'dismissed.');
  }

  /**
   * Expend due to queueing request
   */
  async expandDueToQueueingRequest(client: DataPlaneClient, request: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>) {
    const { requestId, name, isInspect, stats } = request;
    const { brokers = [] } = stats || {};

    this.logger.info('start processing request queueing request(%s) for func(%s, inspect %s)', requestId, name, isInspect);

    const broker = this.workerStatsSnapshot.getBroker(name, isInspect);

    if (broker && broker.prerequestStartingPool() && !broker.disposable) {
      this.logger.info('Request(%s) queueing for func(%s, inspect %s) will not expand because StartingPool is still enough.', requestId, name, isInspect);
      return;
    }

    const profile = this.plane.functionProfile.get(name);

    try {
      this.logger.info('Prepare to launch worker(%s, inspect %s)', name, isInspect);
      const now = performance.now();

      await this.plane.workerLauncher.tryLaunch(
        name,
        {
          inspect: isInspect,
        },
        profile?.worker?.disposable || false,
        false,
        requestId
      );
      this.logger.info('Request(%s) queueing for func(%s, inspect %s) expanded, cost: %sms.', requestId, name, isInspect, performance.now() - now);
    } catch (e) {
      this.logger.warn(`Request(${requestId}) queueing for func(${name}, inspect ${String(isInspect)}) expanding failed.`, e);

      (client as any).startWorkerFastFail(wrapLaunchErrorObject(name, isInspect, e as Error)).catch((e: unknown) => {
        this.logger.warn(e);
      });
    }

    this.logger.info('sync worker data after launch worker(%s)', name);
    // update current workers data
    try {
      if (brokers) {
        await this.syncWorkerData(brokers);
      }
    } catch (e) {
      this.logger.warn('Failed to sync data.', e);
    }
    this.logger.info('worker data synchronized after launch worker(%s)', name);
  }
}

interface RequestQueueItem {
  client: DataPlaneClient;
  data: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>;
}

interface ExpansionOptions {
  inspect?: boolean;
}
