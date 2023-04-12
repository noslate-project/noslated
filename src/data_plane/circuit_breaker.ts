import EventEmitter from 'events';
import os from 'os';
import _ from 'lodash';
import { DataFlowController } from './data_flow_controller';

const logger = require('#self/lib/logger').get('system circuit breaker');

function compare(lhs: number, rhs: number) {
  if (lhs < rhs) {
    return -1;
  }
  if (lhs > rhs) {
    return 1;
  }
  return 0;
}

function sum(arr: number[]) {
  return _.reduce(arr, (prev, curr) => prev + curr, 0);
}

/**
 * A structure that maintain a open/close state.
 */
class CircuitBreaker extends EventEmitter {
  opened = false;
  thresholdConsecutiveCheckTimes = 0;

  constructor(private checker: Checker, public name: string) {
    super();
  }

  check() {
    const res = this.checker();
    if (this.opened) {
      if (res >= 0) {
        return;
      }
      this.thresholdConsecutiveCheckTimes++;
      if (this.thresholdConsecutiveCheckTimes >= 3) {
        this.opened = false;
        this.thresholdConsecutiveCheckTimes = 0;
        logger.info(
          `circuit breaker [${this.name}] status change to [${this.opened}]`
        );
        this.emit('status-changed', this.opened);
      }
    } else {
      if (res <= 0) {
        return;
      }
      this.thresholdConsecutiveCheckTimes++;
      if (this.thresholdConsecutiveCheckTimes >= 5) {
        this.opened = true;
        this.thresholdConsecutiveCheckTimes = 0;
        logger.info(
          `circuit breaker [${this.name}] status change to [${this.opened}]`
        );
        this.emit('status-changed', this.opened);
      }
    }
  }
}

/**
 * SystemCircuitBreaker composites multiple {@link CircuitBreaker}s and exposes
 * a open/close state that is an aggregation of composited CircuitBreakers.
 */
export class SystemCircuitBreaker extends EventEmitter {
  #dataFlowController;
  #config: SystemCircuitBreakerConfig;
  breakers: CircuitBreaker[];
  checkInterval: NodeJS.Timer | undefined;
  #opened: boolean;

  #statusChanged = () => {
    this.#opened = this.breakers.some(breaker => {
      return breaker.opened;
    });

    let current = '';
    this.breakers.forEach(breaker => {
      current += ` (name: ${breaker.name}, status: ${breaker.opened})`;
    });

    logger.info('system circuit breaker status change, current is:', current);
    this.emit('status-changed', this.opened);
  };

  _getActiveRequestCount() {
    return sum(
      Array.from(this.#dataFlowController.brokers.values())
        .flatMap(it => Array.from(it.workers()))
        .map(w => w.activeRequestCount)
    );
  }

  _getPendingRequestCount() {
    return sum(
      Array.from(this.#dataFlowController.brokers.values()).map(
        it => it.requestQueue.length
      )
    );
  }

  _getOsLoad1() {
    return os.loadavg()[0];
  }

  #checkRequestCount = () => {
    const activeRequestCount = this._getActiveRequestCount();
    const pendingRequestCount = this._getPendingRequestCount();
    return compare(
      activeRequestCount + pendingRequestCount,
      this.#config.requestCountLimit
    );
  };

  #checkPendingRequestCount = () => {
    const pendingRequestCount = this._getPendingRequestCount();
    return compare(pendingRequestCount, this.#config.pendingRequestCountLimit);
  };

  #checkSystemLoad = () => {
    const load1 = this._getOsLoad1();
    return compare(load1, this.#config.systemLoad1Limit);
  };

  #check = () => {
    this.breakers.forEach(it => it.check());
  };

  constructor(
    dataFlowController: DataFlowController,
    config: SystemCircuitBreakerConfig
  ) {
    super();
    this.#dataFlowController = dataFlowController;
    this.#config = config;
    this.checkInterval = undefined;
    this.#opened = false;

    const breakerSet = [
      ['request-count', this.#checkRequestCount],
      ['pending-request-count', this.#checkPendingRequestCount],
      ['system-load', this.#checkSystemLoad],
    ] as const;

    this.breakers = breakerSet.map(([name, checker]) => {
      const breaker = new CircuitBreaker(checker, name);
      // TODO: exposes change reason (i.e. which subsidiary state has been changed).
      breaker.on('status-changed', this.#statusChanged);
      return breaker;
    });
  }

  get opened() {
    return this.#opened;
  }

  start() {
    this.checkInterval = setInterval(this.#check, 1000);
  }

  /**
   * Cleanup the circuit breaker;
   */
  close() {
    clearInterval(this.checkInterval);
  }
}

interface SystemCircuitBreakerConfig {
  requestCountLimit: number;
  pendingRequestCountLimit: number;
  systemLoad1Limit: number;
}

type Checker = () => 0 | 1 | -1;
