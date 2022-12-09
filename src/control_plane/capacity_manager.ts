import bytes from 'bytes';
import { Base } from '#self/lib/sdk_base';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { Broker, WorkerStatsSnapshot } from './worker_stats';
import { wrapLaunchErrorObject } from './worker_launcher_error_code';
import { ControlPlane } from './control_plane';
import { Config } from '#self/config';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { DataPlaneClient } from './data_plane_client/client';
import * as root from '#self/proto/root';
import { performance } from 'perf_hooks';
import { NotNullableInterface } from '#self/lib/interfaces';
import { ContainerStatus, ContainerStatusReport, ControlPanelEvent } from '#self/lib/constants';
import _ from 'lodash';
/**
 * CapacityManager
 */
export class CapacityManager extends Base {
  functionProfileManager: FunctionProfileManager;
  workerStatsSnapshot: WorkerStatsSnapshot;
  virtualMemoryPoolSize: number;
  logger: Logger;

  constructor(public plane: ControlPlane, public config: Config) {
    super();

    this.functionProfileManager = plane.functionProfile;
    this.workerStatsSnapshot = new WorkerStatsSnapshot(plane.functionProfile, config, plane.turf);
    this.virtualMemoryPoolSize = bytes(config.virtualMemoryPoolSize);
    this.logger = loggers.get('capacity manager');
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
   * 预估扩缩容指标
   * @param {Broker[]} brokers
   * @returns
   */
  evaluteScaleDeltas(brokers: Broker[]): { expandDeltas: Delta[], shrinkDeltas: Delta[]; } {
    const expandDeltas: Delta[] = [];
    const shrinkDeltas: Delta[] = [];

    // 若扩缩容后小于预留数，则强行扩缩容至预留数。
    for (const broker of brokers) {
      // disposable 模式和 inspect 不预留
      if (broker.isInspector || broker.disposable) {
        continue;
      }

      let count = broker.evaluateWaterLevel(false);

      if (broker.workerCount < broker.reservationCount) {
        // 扩容至预留数
        count = Math.max(count, broker.reservationCount - broker.workerCount);
      } else if (broker.workerCount + count < broker.reservationCount) {
        // 缩容至预留数
        count = broker.reservationCount - broker.workerCount;
      }

      const delta = { broker, count };

      if (count > 0) {
        expandDeltas.push(delta);
      } else if (count < 0) {
        shrinkDeltas.push(delta);
      }
    }

    this.regulateDeltas(expandDeltas);

    return {
      expandDeltas,
      shrinkDeltas
    };
  }

  /**
   * 根据内存资源使用情况就地调整扩缩容指标
   * @param {Delta[]} deltas
   */
  regulateDeltas(deltas: Delta[]) {
    const memoUsed = this.plane.capacityManager.virtualMemoryUsed;
    const needMemo = deltas.reduce((memo, delta, i) => {
      const broker: Broker = delta.broker;
      return delta.count > 0 ? memo + delta.count * broker.memoryLimit : memo;
    }, 0);

    let rate = 1.0;

    if (needMemo + memoUsed > this.plane.capacityManager.virtualMemoryPoolSize) {
      rate = (this.plane.capacityManager.virtualMemoryPoolSize - memoUsed) / needMemo;
      for (let i = 0; i < deltas.length; i++) {
        const { count, broker } = deltas[i];
        if (count > 0) {
          const newDeltas = Math.floor(deltas[i].count * rate);

          this.logger.info(
            `[Auto Scale] Up to expand %d workers %s. ` +
            `waterlevel: %d/%d, ` +
            `delta: %d, memo rate: %d, reservation: %d, ` +
            `current: %d.`, newDeltas, broker.name, broker.activeRequestCount, broker.totalMaxActivateRequests, deltas[i].count, rate, broker.reservationCount, broker.workerCount);

          deltas[i].count = newDeltas;
        }
      }
    }
  }

  /**
   * Auto scale.
   * @return {Promise<void>} The result.
   */
  async autoScale() {
    // 先创建 brokers
    const { reservationCountPerFunction } = this.plane.capacityManager.config.worker;
    for (const profile of this.plane.capacityManager.functionProfileManager.profile) {
      const reservationCount = profile?.worker?.reservationCount;
      if (reservationCount === 0) continue;
      if (reservationCount || reservationCountPerFunction) {
        this.plane.capacityManager.workerStatsSnapshot.getOrCreateBroker(profile.name, false, profile.worker?.disposable);
      }
    }

    const brokers = [...this.plane.capacityManager.workerStatsSnapshot.brokers.values()];
    const {
      expandDeltas,
      shrinkDeltas
    } = this.evaluteScaleDeltas(brokers);

    const {
      'true': reservationDeltas = [],
      'false': regularDeltas = []
    } = _.groupBy(expandDeltas, delta => delta.broker.workerCount < delta.broker.reservationCount);

    const errors = [];

    try {
      await this.plane.controller.shrink(shrinkDeltas);
    } catch (e) {
      errors.push(e);
    }

    try {
      await Promise.all([
        this.plane.controller.expand(regularDeltas),
        this.plane.reservationController.expand(reservationDeltas)
      ]);
    } catch (e) {
      errors.push(e);
    }

    if (errors.length) {
      throw errors[0];
    }
  }

  /**
   * @type {number}
   */
  get virtualMemoryUsed() {
    return [...this.workerStatsSnapshot.brokers.values()].reduce((memo, broker) => (memo + broker.virtualMemory), 0);
  }

  async updateWorkerContainerStatus(report: NotNullableInterface<root.noslated.data.IContainerStatusReport>) {
    const { functionName, name, event, isInspector } = report;

    const broker = this.workerStatsSnapshot.getBroker(functionName, isInspector);
    const worker = this.workerStatsSnapshot.getWorker(functionName, isInspector, name);

    if (broker && worker) {
      worker.updateContainerStatusByEvent(event as ContainerStatusReport);

      // 如果已经 ready，则从 starting pool 中移除
      if (worker.containerStatus === ContainerStatus.Ready) {
        broker.removeItemFromStartingPool(worker.name);
      }

      if (event === ContainerStatusReport.RequestDrained && worker.containerStatus === ContainerStatus.Stopped && worker.disposable) {
        // wait next sync to gc worker data and related resources
        const now = performance.now();

        worker.requestId = report.requestId;

        this.logger.info('will kill worker(%s) with request(%s) because useCGIMode=true and request drained.', worker.name, report.requestId);

        this.plane.controller.stopWorker(worker.name, report.requestId)
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
   * Expend due to queueing request
   * @param {{ data: import('#self/lib/proto/noslated/data-plane-broadcast').RequestQueueingBroadcast, client: import('#self/control_plane/data_plane_client/client') }} task The task object.
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
      const now = performance.now();

      await this.plane.workerLauncher.tryLaunch(
        ControlPanelEvent.RequestQueueExpand,
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
      this.logger.warn(`Request(%s) queueing for func(%s, inspect %s) expanding failed.`, requestId, name, isInspect, e);

      (client as any).startWorkerFastFail(wrapLaunchErrorObject(name, isInspect, e as Error)).catch((e: unknown) => {
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
}

export type Delta = {
  count: number;
  broker: Broker;
};
