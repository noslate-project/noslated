import EventEmitter from 'events';
import { BaseOf } from '#self/lib/sdk_base';
import { Broker } from './broker';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { Worker, WorkerMetadata } from './worker';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Config } from '#self/config';
import { TurfState } from '#self/lib/turf/types';
import * as root from '#self/proto/root';
import { ContainerStatus } from '#self/lib/constants';
import { StatLogger } from './stat_logger';

export class WorkerStatsSnapshot extends BaseOf(EventEmitter) {
  private logger: Logger;
  private profiles: FunctionProfileManager;
  public brokers: Map<string, Broker>;
  private statLogger: StatLogger;

  constructor(profileManager: FunctionProfileManager, public config: Config) {
    super();

    this.logger = loggers.get('worker_stats snapshot');
    this.profiles = profileManager;

    this.statLogger = new StatLogger();

    this.brokers = new Map();
  }

  /**
   * Sync data from data plane.
   */
  sync(syncData: root.noslated.data.IBrokerStats[]) {
    const newMap: Map<string, Broker> = new Map();
    for (const item of syncData) {
      const key = Broker.getKey(item.functionName!, item.inspector!);
      const broker = this.getBroker(item.functionName!, item.inspector!);
      if (!broker) {
        // 一切以 Control Plane 已存在数据为准
        continue;
      }

      broker.sync(item.workers!);
      newMap.set(key, broker);
      this.brokers.delete(key);
    }

    for (const [key, value] of this.brokers.entries()) {
      value.sync([]);
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
      disposable
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
  register(workerMetadata: WorkerMetadata): Worker {
    const broker = this.getOrCreateBroker(
      workerMetadata.funcName,
      workerMetadata.options.inspect,
      workerMetadata.disposable
    );
    if (!broker) {
      throw new Error(
        `No function named ${workerMetadata.funcName} in function profile.`
      );
    }
    return broker.register(workerMetadata);
  }

  /**
   * TODO: resource manager
   * Unregister worker.
   * @param {string} funcName The function name.
   * @param {string} processName The process name (worker name).
   * @param {boolean} isInspector Whether it's using inspector or not.
   */
  async unregister(
    funcName: string,
    processName: string,
    isInspector: boolean
  ) {
    const brokerKey = Broker.getKey(funcName, isInspector);
    const broker = this.brokers.get(brokerKey);
    if (!broker) return;
    // TODO: resource manager
    await broker.unregister(processName);

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
   * TODO: resource manager
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
        await worker.container!.stop();
      } catch (e) {
        this.logger.warn(
          `Failed to stop worker [${worker.name}] via \`.#tryGC()\`.`,
          e
        );
      }

      try {
        state = (await worker.container!.state()) as TurfState;
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
        await worker.container!.terminated;
        await worker.container!.delete();
      } catch (e) {
        this.logger.warn(
          'Failed to delete worker [%s] via `.#tryGC()`.',
          worker.name,
          e
        );
      }

      broker.workers.delete(worker.name);
    }
  }

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

    const result = await Promise.allSettled(gcs);
    for (const it of result) {
      if (it.status === 'rejected') {
        this.logger.error('unexpected error on gc', it.reason);
      }
    }

    for (const broker of [...this.brokers.values()]) {
      if (!broker.workers.size && !broker.data) {
        this.brokers.delete(Broker.getKey(broker.name, broker.isInspector));
      }
    }
  }
}
