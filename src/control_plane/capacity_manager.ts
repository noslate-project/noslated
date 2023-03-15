import bytes from 'bytes';
import { Base } from '#self/lib/sdk_base';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { Broker } from './worker_stats/broker';
import { RequestQueueingEvent } from './events';
import { ControlPlaneDependencyContext } from './deps';
import { StateManager } from './worker_stats/state_manager';
import { kMemoryLimit } from './constants';
import { RawWithDefaultsFunctionProfile } from '#self/lib/json/function_profile';
import { ErrorCode } from './worker_launcher_error_code';

enum WaterLevelAction {
  UNKNOWN = 0,
  NORMAL = 1,
  NEED_EXPAND = 2,
  NEED_SHRINK = 3,
}

/**
 * CapacityManager
 */
export class CapacityManager extends Base {
  private _shrinkRedundantTimes: number;
  private virtualMemoryPoolSize: number;
  private logger: Logger;
  private stateManager: StateManager;

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    const config = ctx.getInstance('config');
    this.stateManager = ctx.getInstance('stateManager');

    this.virtualMemoryPoolSize = bytes(config.virtualMemoryPoolSize);
    this._shrinkRedundantTimes = config.worker.shrinkRedundantTimes;
    this.logger = loggers.get('capacity manager');
  }

  /**
   * 预估扩缩容指标
   * @param {Broker[]} brokers
   * @returns
   */
  evaluateScaleDeltas(brokers: Broker[]): {
    expandDeltas: Delta[];
    shrinkDeltas: Delta[];
  } {
    const expandDeltas: Delta[] = [];
    const shrinkDeltas: Delta[] = [];

    // 若扩缩容后小于预留数，则强行扩缩容至预留数。
    for (const broker of brokers) {
      // disposable 模式和 inspect 不预留
      if (broker.isInspector || broker.disposable) {
        continue;
      }

      let count = this.evaluateWaterLevel(broker, false);

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
      shrinkDeltas,
    };
  }

  /**
   * 根据内存资源使用情况就地调整扩缩容指标
   * @param {Delta[]} deltas
   */
  regulateDeltas(deltas: Delta[]) {
    const memoUsed = this.virtualMemoryUsed;
    const needMemo = deltas.reduce((memo, delta) => {
      const broker: Broker = delta.broker;
      return delta.count > 0 ? memo + delta.count * broker.memoryLimit : memo;
    }, 0);

    let rate = 1.0;

    if (needMemo + memoUsed > this.virtualMemoryPoolSize) {
      rate = (this.virtualMemoryPoolSize - memoUsed) / needMemo;
      for (let i = 0; i < deltas.length; i++) {
        const { count, broker } = deltas[i];
        if (count > 0) {
          const newDeltas = Math.floor(deltas[i].count * rate);

          this.logger.info(
            '[Auto Scale] Up to expand %d workers %s. ' +
              'waterlevel: %d/%d, ' +
              'delta: %d, memo rate: %d, reservation: %d, ' +
              'current: %d.',
            newDeltas,
            broker.name,
            broker.activeRequestCount,
            broker.totalMaxActivateRequests,
            deltas[i].count,
            rate,
            broker.reservationCount,
            broker.workerCount
          );

          deltas[i].count = newDeltas;
        }
      }
    }
  }

  /**
   * @type {number}
   */
  get virtualMemoryUsed() {
    return [...this.stateManager.brokers()].reduce(
      (memo, broker) => memo + broker.virtualMemory,
      0
    );
  }

  allowExpandingOnRequestQueueing(event: RequestQueueingEvent): boolean {
    const { name, isInspect, requestId } = event.data;

    const broker = this.stateManager.getBroker(name, isInspect);

    if (broker && !broker.disposable && broker.prerequestStartingPool()) {
      this.logger.info(
        'Request(%s) queueing for func(%s, inspect %s, disposable %s) will not expand because StartingPool is still enough.',
        requestId,
        name,
        isInspect,
        broker.disposable
      );
      return false;
    }

    return true;
  }

  /**
   * Evaluate the water level.
   * @param {boolean} [expansionOnly] Whether do the expansion action only or not.
   * @return {number} How much processes (workers) should be scale. (> 0 means expand, < 0 means shrink)
   */
  evaluateWaterLevel(broker: Broker, expansionOnly = false) {
    if (broker.disposable) {
      return 0;
    }

    if (!broker.data) {
      return expansionOnly ? 0 : -broker.workers.size;
    }

    if (!broker.workerCount) {
      return 0;
    }

    const { activeRequestCount, totalMaxActivateRequests } = broker;
    const waterLevel = activeRequestCount / totalMaxActivateRequests;

    let waterLevelAction = WaterLevelAction.UNKNOWN;

    // First check is this function still existing
    if (!expansionOnly) {
      if (waterLevel <= 0.6 && broker.workerCount > broker.reservationCount) {
        waterLevelAction = waterLevelAction || WaterLevelAction.NEED_SHRINK;
      }

      // If only one worker left, and still have request, reserve it
      if (
        waterLevelAction === WaterLevelAction.NEED_SHRINK &&
        broker.workerCount === 1 &&
        broker.activeRequestCount !== 0
      ) {
        waterLevelAction = WaterLevelAction.NORMAL;
      }
    }

    if (waterLevel >= 0.8)
      waterLevelAction = waterLevelAction || WaterLevelAction.NEED_EXPAND;
    waterLevelAction = waterLevelAction || WaterLevelAction.NORMAL;

    switch (waterLevelAction) {
      case WaterLevelAction.NEED_SHRINK: {
        broker.redundantTimes++;

        if (broker.redundantTimes >= this._shrinkRedundantTimes) {
          // up to shrink
          const newMaxActivateRequests = activeRequestCount / 0.7;
          const deltaMaxActivateRequests =
            totalMaxActivateRequests - newMaxActivateRequests;
          let deltaInstance = Math.floor(
            deltaMaxActivateRequests / broker.data.worker!.maxActivateRequests!
          );

          // reserve at least `this.reservationCount` instances
          if (broker.workerCount - deltaInstance < broker.reservationCount) {
            deltaInstance = broker.workerCount - broker.reservationCount;
          }

          broker.redundantTimes = 0;
          return -deltaInstance;
        }

        return 0;
      }

      case WaterLevelAction.NORMAL:
      case WaterLevelAction.NEED_EXPAND:
      default: {
        broker.redundantTimes = 0;
        if (waterLevelAction !== WaterLevelAction.NEED_EXPAND) return 0;

        const newMaxActivateRequests = activeRequestCount / 0.7;
        const deltaMaxActivateRequests =
          newMaxActivateRequests - totalMaxActivateRequests;
        let deltaInstanceCount = Math.ceil(
          deltaMaxActivateRequests / broker.data.worker!.maxActivateRequests!
        );
        deltaInstanceCount =
          broker.data.worker!.replicaCountLimit! <
          broker.workerCount + deltaInstanceCount
            ? broker.data.worker!.replicaCountLimit! - broker.workerCount
            : deltaInstanceCount;

        return Math.max(deltaInstanceCount, 0);
      }
    }
  }

  assertExpandingAllowed(
    funcName: string,
    inspect: boolean,
    profile: RawWithDefaultsFunctionProfile
  ): void {
    // get broker / virtualMemoryUsed / virtualMemoryPoolSize, etc.
    const broker = this.stateManager.getOrCreateBroker(funcName, inspect);
    if (!broker) {
      const err = new Error(`No broker named ${funcName})}`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const {
      worker: { replicaCountLimit },
      resourceLimit: { memory = kMemoryLimit },
    } = profile;
    if (this.virtualMemoryUsed + memory > this.virtualMemoryPoolSize) {
      const err = new Error(
        `No enough virtual memory (used: ${this.virtualMemoryUsed} + need: ${memory}) > total: ${this.virtualMemoryPoolSize}`
      );
      err.code = ErrorCode.kNoEnoughVirtualMemoryPoolSize;
      throw err;
    }

    // inspect 模式只开启一个
    if (broker.workerCount && inspect) {
      const err = new Error(
        `Replica count exceeded limit in inspect mode (${broker.workerCount} / ${replicaCountLimit})`
      );
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }

    if (broker.workerCount >= replicaCountLimit) {
      const err = new Error(
        `Replica count exceeded limit (${broker.workerCount} / ${replicaCountLimit})`
      );
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }
  }
}

export type Delta = {
  count: number;
  broker: Broker;
};
