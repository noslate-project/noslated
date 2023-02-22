import bytes from 'bytes';
import { Base } from '#self/lib/sdk_base';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { Broker } from './worker_stats';
import { RequestQueueingEvent } from './events';
import { ControlPlaneDependencyContext } from './deps';
import { StateManager } from './worker_stats/state_manager';

/**
 * CapacityManager
 */
export class CapacityManager extends Base {
  virtualMemoryPoolSize: number;
  logger: Logger;
  stateManager: StateManager;

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    const config = ctx.getInstance('config');
    this.stateManager = ctx.getInstance('stateManager');

    this.virtualMemoryPoolSize = bytes(config.virtualMemoryPoolSize);
    this.logger = loggers.get('capacity manager');
  }

  /**
   * 预估扩缩容指标
   * @param {Broker[]} brokers
   * @returns
   */
  evaluteScaleDeltas(brokers: Broker[]): {
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
      shrinkDeltas,
    };
  }

  /**
   * 根据内存资源使用情况就地调整扩缩容指标
   * @param {Delta[]} deltas
   */
  regulateDeltas(deltas: Delta[]) {
    const memoUsed = this.virtualMemoryUsed;
    const needMemo = deltas.reduce((memo, delta, i) => {
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

    if (broker && broker.prerequestStartingPool() && !broker.disposable) {
      this.logger.info(
        'Request(%s) queueing for func(%s, inspect %s) will not expand because StartingPool is still enough.',
        requestId,
        name,
        isInspect
      );
      return false;
    }

    return true;
  }
}

export type Delta = {
  count: number;
  broker: Broker;
};
