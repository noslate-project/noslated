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
import { ErrorCode, LauncherError } from './worker_launcher_error_code';

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
  private _scalingStage: number;
  private virtualMemoryPoolSize: number;
  private logger: Logger;
  private stateManager: StateManager;
  private _useEmaScaling: boolean;

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    const config = ctx.getInstance('config');
    this.stateManager = ctx.getInstance('stateManager');
    this.virtualMemoryPoolSize = bytes(config.virtualMemoryPoolSize);
    this._shrinkRedundantTimes =
      config.controlPlane.workerRedundantVictimSpareTimes;
    this._scalingStage = config.controlPlane.capacityScalingStage;
    this.logger = loggers.get('capacity manager');
    this._useEmaScaling = config.controlPlane.useEmaScaling;
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

      if (broker.activeWorkerCount < broker.reservationCount) {
        // 扩容至预留数
        count = Math.max(
          count,
          broker.reservationCount - broker.activeWorkerCount
        );
      } else if (broker.activeWorkerCount + count < broker.reservationCount) {
        // 缩容至预留数
        count = broker.reservationCount - broker.activeWorkerCount;
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
            broker.getActiveRequestCount(),
            broker.totalMaxActivateRequests,
            deltas[i].count,
            rate,
            broker.reservationCount,
            broker.activeWorkerCount
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

  allowExpandingOnRequestQueueing(
    event: RequestQueueingEvent['data']
  ): boolean {
    const { name, isInspect, requestId, queuedRequestCount } = event;

    const broker = this.stateManager.getOrCreateBroker(name, isInspect);
    if (broker == null) {
      return false;
    }

    if (broker.disposable) {
      return true;
    }

    if (
      queuedRequestCount <
      broker.initiatingWorkerCount * broker.profile.worker.maxActivateRequests
    ) {
      this.logger.info(
        'Request(%s) queued for func(%s) not allowed to expand for sufficient initiating worker count.',
        requestId,
        name
      );
      return false;
    }

    return true;
  }

  /**
   * 使用 ema concurrency 计算扩容水位
   * TODO: 进一步可以引入历史指标趋势计算
   * return 0; 什么都不做
   * return >0; 扩容
   * return <0; 缩容
   * @returns
   */
  private evaluateWaterLevelByEMAConcurrency(broker: Broker) {
    const { totalMaxActivateRequests } = broker;
    const emaConcurrency = broker.getEMAConcurrency();
    const waterLevel = emaConcurrency / totalMaxActivateRequests;
    const requiredCapacity = emaConcurrency / broker.scaleFactor;
    const requiredWorkers = Math.ceil(
      requiredCapacity / broker.profile.worker.maxActivateRequests
    );

    let delta = 0;
    const now = Date.now();

    if (
      waterLevel > broker.concurrencyExpandThreshold ||
      broker.activeWorkerCount < broker.reservationCount
    ) {
      if (broker.isExpandCooldown(now)) {
        this.logger.info(
          '[Auto Scale] [%s] expand cooldown, ema concurrency is %d, water level is %d, required worker is %d, skip.',
          broker.name,
          emaConcurrency,
          waterLevel,
          requiredWorkers
        );
        return 0;
      }
      const workersToAdd =
        Math.max(requiredWorkers, broker.reservationCount) -
        broker.activeWorkerCount;

      broker.resetExpandCooldownTime(now);

      delta = workersToAdd;
    } else if (
      waterLevel < broker.concurrencyShrinkThreshold &&
      broker.activeWorkerCount > requiredWorkers
    ) {
      if (broker.isShirnkCooldown(now)) {
        this.logger.info(
          '[Auto Scale] [%s] shrink cooldown, ema concurrency is %d, water level is %d, required worker is %d, skip.',
          broker.name,
          emaConcurrency,
          waterLevel,
          requiredWorkers
        );
        return 0;
      }
      const shouldRetainOneWorker =
        broker.activeWorkerCount === 1 && emaConcurrency > 0;
      const workersToRemove = shouldRetainOneWorker
        ? 0
        : broker.activeWorkerCount -
          Math.max(requiredWorkers, broker.reservationCount);

      broker.resetShrinkCooldownTime(now);

      delta = -workersToRemove;
    }

    this.logger.info(
      '[Auto Scale] ema concurrency is %d, water level is %d, required workers is %d, plan scale delta %d workers %s. ',
      emaConcurrency,
      waterLevel,
      requiredWorkers,
      delta,
      broker.name
    );

    return delta;
  }

  private evaluateWaterLevelLegacy(broker: Broker, expansionOnly: boolean) {
    const { totalMaxActivateRequests } = broker;
    const activeRequestCount = broker.getActiveRequestCount();
    const waterLevel = activeRequestCount / totalMaxActivateRequests;

    let waterLevelAction = WaterLevelAction.UNKNOWN;

    // First check is this function still existing
    if (!expansionOnly) {
      if (
        waterLevel <= 0.6 &&
        broker.activeWorkerCount > broker.reservationCount
      ) {
        waterLevelAction = waterLevelAction || WaterLevelAction.NEED_SHRINK;
      }

      // If only one worker left, and still have request, reserve it
      if (
        waterLevelAction === WaterLevelAction.NEED_SHRINK &&
        broker.activeWorkerCount === 1 &&
        activeRequestCount !== 0
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
          const newMaxActivateRequests =
            activeRequestCount / this._scalingStage;
          const deltaMaxActivateRequests =
            totalMaxActivateRequests - newMaxActivateRequests;
          let deltaInstance = Math.floor(
            deltaMaxActivateRequests / broker.profile.worker.maxActivateRequests
          );

          // reserve at least `this.reservationCount` instances
          if (
            broker.activeWorkerCount - deltaInstance <
            broker.reservationCount
          ) {
            deltaInstance = broker.activeWorkerCount - broker.reservationCount;
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

        const newMaxActivateRequests = activeRequestCount / this._scalingStage;
        const deltaMaxActivateRequests =
          newMaxActivateRequests - totalMaxActivateRequests;
        let deltaInstanceCount = Math.ceil(
          deltaMaxActivateRequests / broker.profile.worker.maxActivateRequests
        );
        deltaInstanceCount =
          broker.profile.worker.replicaCountLimit <
          broker.activeWorkerCount + deltaInstanceCount
            ? broker.profile.worker.replicaCountLimit - broker.activeWorkerCount
            : deltaInstanceCount;

        return Math.max(deltaInstanceCount, 0);
      }
    }
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

    if (!broker.activeWorkerCount) {
      return 0;
    }

    return this._useEmaScaling
      ? this.evaluateWaterLevelByEMAConcurrency(broker)
      : this.evaluateWaterLevelLegacy(broker, expansionOnly);
  }

  assertExpandingAllowed(
    funcName: string,
    inspect: boolean,
    profile: RawWithDefaultsFunctionProfile
  ): void {
    // get broker / virtualMemoryUsed / virtualMemoryPoolSize, etc.
    const broker = this.stateManager.getOrCreateBroker(funcName, inspect);
    if (!broker) {
      throw new LauncherError(ErrorCode.kNoFunction);
    }

    const {
      worker: { replicaCountLimit },
      resourceLimit: { memory = kMemoryLimit },
    } = profile;

    // inspect 模式只开启一个
    if (broker.activeWorkerCount && inspect) {
      throw new LauncherError(ErrorCode.kReplicaLimitExceededInspector);
    }

    const initiatingAndActiveCount =
      broker.initiatingWorkerCount + broker.activeWorkerCount;
    if (initiatingAndActiveCount >= replicaCountLimit) {
      throw new LauncherError(
        ErrorCode.kReplicaLimitExceeded,
        initiatingAndActiveCount,
        replicaCountLimit
      );
    }

    if (this.virtualMemoryUsed + memory > this.virtualMemoryPoolSize) {
      throw new LauncherError(
        ErrorCode.kNoEnoughVirtualMemoryPoolSize,
        this.virtualMemoryUsed,
        memory,
        this.virtualMemoryPoolSize
      );
    }
  }
}

export type Delta = {
  count: number;
  broker: Broker;
};
