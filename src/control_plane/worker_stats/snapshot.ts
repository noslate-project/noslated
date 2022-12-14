import EventEmitter from 'events';
import fs from 'fs';
import { BaseOf } from '#self/lib/sdk_base';
import { Broker } from './broker';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import * as starters from '../starter';
import { Worker } from './worker';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Config } from '#self/config';
import { TurfProcess, TurfState } from '#self/lib/turf/types';
import * as root from '#self/proto/root';
import { ContainerStatus } from '#self/lib/constants';
import { StatLogger } from './stat_logger';
import { Turf } from '#self/lib/turf';
import { Clock, systemClock } from '#self/lib/clock';
import { TaskQueue } from '#self/lib/task_queue';

export class WorkerStatsSnapshot extends BaseOf(EventEmitter) {
  private logger: Logger;
  private profiles: FunctionProfileManager;
  public brokers: Map<string, Broker>;
  private statLogger: StatLogger;

  private gcQueue: TaskQueue<Worker>;

  constructor(
    profileManager: FunctionProfileManager,
    public config: Config,
    private turf: Turf,
    private clock: Clock = systemClock
  ) {
    super();

    this.logger = loggers.get('worker_stats snapshot');
    this.profiles = profileManager;

    this.statLogger = new StatLogger();

    this.brokers = new Map();

    this.gcQueue = new TaskQueue<Worker>(this.#gcLog, {
      clock: this.clock,
    });
  }

  async _init() {
    // ignore
  }

  async _close() {
    /** ignore unfinished tasks */
    this.gcQueue.clear();
    this.gcQueue.close();
  }

  /**
   * Sync data from data plane and turf ps.
   */
  sync(syncData: root.noslated.data.IBrokerStats[], psData: TurfProcess[]) {
    const newMap: Map<string, Broker> = new Map();
    for (const item of syncData) {
      const key = Broker.getKey(item.functionName!, item.inspector!);
      const broker = this.getBroker(item.functionName!, item.inspector!);
      if (!broker) {
        // 一切以 Control Plane 已存在数据为准
        continue;
      }

      broker.sync(item.workers!, psData);
      newMap.set(key, broker);
      this.brokers.delete(key);
    }

    for (const [key, value] of this.brokers.entries()) {
      value.sync([], psData);
      newMap.set(key, value);
    }

    this.brokers = newMap;
  }

  /**
   * Get broker by function name and `isInspector`.
   */
  getBroker(functionName: string, isInspector: boolean): Broker | null {
    return this.brokers.get(Broker.getKey(functionName, isInspector)) || null;
  }

  /**
   * Get or create broker by function name and `isInspector`.
   */
  getOrCreateBroker(
    functionName: string,
    isInspector: boolean,
    disposable = false
  ): Broker | null {
    let broker = this.getBroker(functionName, isInspector);
    if (broker) return broker;
    if (!this.profiles.get(functionName)) return null;
    broker = new Broker(
      this.profiles,
      this.config,
      functionName,
      isInspector,
      disposable,
      this.turf
    );
    this.brokers.set(Broker.getKey(functionName, isInspector), broker);
    return broker;
  }

  /**
   * Get worker object.
   */
  getWorker(
    functionName: string,
    isInspector: boolean,
    workerName: string
  ): Worker | null {
    const broker = this.getBroker(functionName, isInspector);
    if (!broker) return null;
    return broker.getWorker(workerName) || null;
  }

  /**
   * Register worker.
   * @param {string} funcName The function name.
   * @param {string} processName The process name (worker name).
   * @param {string} credential The credential.
   * @param {boolean} isInspector Whether it's using inspector or not.
   */
  register(
    funcName: string,
    processName: string,
    credential: string,
    isInspector: boolean,
    disposable = false
  ): Worker {
    const broker = this.getOrCreateBroker(funcName, isInspector, disposable);
    if (!broker) {
      throw new Error(`No function named ${funcName} in function profile.`);
    }
    return broker.register(processName, credential);
  }

  /**
   * Unregister worker.
   * @param {string} funcName The function name.
   * @param {string} processName The process name (worker name).
   * @param {boolean} isInspector Whether it's using inspector or not.
   */
  unregister(funcName: string, processName: string, isInspector: boolean) {
    const brokerKey = Broker.getKey(funcName, isInspector);
    const broker = this.brokers.get(brokerKey);
    if (!broker) return;
    broker.unregister(processName, true);

    /* istanbul ignore else */
    if (!broker.workerCount) {
      this.brokers.delete(brokerKey);
    }
  }

  toProtobufObject(): root.noslated.data.IBrokerStats[] {
    return [...this.brokers.values()].map(broker => ({
      name: broker.name,
      inspector: broker.isInspector,
      profile: broker.data,
      redundantTimes: broker.redundantTimes,
      startingPool: [...broker.startingPool.entries()].map(([key, value]) => ({
        workerName: key,
        credential: value.credential,
        estimateRequestLeft: value.estimateRequestLeft,
        maxActivateRequests: value.maxActivateRequests,
      })),
      workers: [...broker.workers.values()].map(worker => ({
        name: worker.name,
        credential: worker.credential,
        registerTime: worker.registerTime,
        pid: worker.pid,
        turfContainerStates: worker.turfContainerStates,
        containerStatus: worker.containerStatus,
        data: worker.data
          ? {
              maxActivateRequests: worker.data.maxActivateRequests,
              activeRequestCount: worker.data.activeRequestCount,
            }
          : null,
      })),
    }));
  }

  /**
   * Try worker GC.
   * @param {Broker} broker The broker object.
   * @param {Worker} worker The worker object.
   * @return {Promise<void>} The result.
   */
  async #tryGC(broker: Broker, worker: Worker) {
    if (!broker.getWorker(worker.name)) {
      throw new Error(
        `Worker ${worker.name} not belongs to broker ${Broker.getKey(
          broker.name,
          broker.isInspector
        )}`
      );
    }

    // 进入该状态，必然要被 GC
    if (
      worker.containerStatus === ContainerStatus.Stopped ||
      worker.containerStatus === ContainerStatus.Unknown
    ) {
      let state;
      let emitExceptionMessage;

      try {
        await this.turf.stop(worker.name);
      } catch (e) {
        this.logger.warn(
          `Failed to stop worker [${worker.name}] via \`.#tryGC()\`.`,
          e
        );
      }

      try {
        state = (await this.turf.state(worker.name)) as TurfState;
        const stime = state['rusage.stime'] ?? 0;
        const utime = state['rusage.utime'] ?? 0;
        //TODO(yilong.lyl): fix typo @zl131478
        const rss = state['rusage.masrss'];

        this.statLogger.exit(
          state.name,
          state.pid,
          state.exitcode ?? null,
          state['killed.signal'] ?? null,
          stime + utime,
          rss,
          worker.requestId ?? null
        );

        this.logger.info("%s's last state: %j", worker.name, state);
      } catch (e) {
        emitExceptionMessage = 'failed_to_state';
        this.logger.warn('Failed to state worker [%s]', worker.name, e);
      }

      broker.removeItemFromStartingPool(worker.name);
      this.emit('workerStopped', emitExceptionMessage, state, broker, worker);

      try {
        // 清理 turf 数据
        await this.turf.delete(worker.name);
      } catch (e) {
        this.logger.warn(
          'Failed to delete worker [%s] via `.#tryGC()`.',
          worker.name,
          e
        );
      }

      // 清理 log 文件
      this.gcQueue.enqueue(worker, {
        delay: this.config.worker.gcLogDelay,
      });

      broker.workers.delete(worker.name);
    }
  }

  #gcLog = async (worker: Worker) => {
    const logDir = starters.logPath(this.config.logger.dir, worker.name);
    try {
      await fs.promises.rm(logDir, { recursive: true });
      this.logger.debug('[%s] log directory removed: %s.', worker.name, logDir);
    } catch (e) {
      this.logger.warn(
        'Failed to rm [%s] log directory: %s.',
        worker.name,
        logDir,
        e
      );
    }
  };

  /**
   * Correct synced data (remove GCed items)
   * @return {Promise<void>} The result.
   */
  async correct() {
    const gcs = [];
    for (const broker of this.brokers.values()) {
      for (const worker of broker.workers.values()) {
        gcs.push(this.#tryGC(broker, worker));
      }
    }

    await Promise.allSettled(gcs);

    for (const broker of [...this.brokers.values()]) {
      if (!broker.workers.size && !broker.data) {
        this.brokers.delete(Broker.getKey(broker.name, broker.isInspector));
      }
    }
  }
}
