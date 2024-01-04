import * as root from '#self/proto/root';
import {
  ControlPlaneEvent,
  WorkerStatus,
  WorkerStatusReport,
} from '#self/lib/constants';
import { Logger, loggers, PrefixedLogger } from '#self/lib/loggers';
import {
  ContainerReconciledEvent,
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
  WorkerTrafficStatsEvent,
} from '../events';
import { Config } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { Broker } from './broker';
import { Worker, WorkerMetadata, WorkerStats } from './worker';
import { ControlPlaneDependencyContext } from '../deps';
import { StatLogger } from './stat_logger';
import { EventBus } from '#self/lib/event-bus';
import { RawWithDefaultsFunctionProfile } from '#self/lib/json/function_profile';
import { FunctionsRemovedEvent } from '#self/lib/function_profile';

export class StateManager extends Base {
  private _logger: Logger;
  private _config: Config;
  private _functionProfile;
  private _eventBus: EventBus;

  _brokers: Map<string, Broker> = new Map();
  private _statLogger: StatLogger;

  private _gcWorkers: Set<Worker> = new Set();

  private _useEmaScaling: boolean;

  private _dumpLogger: Pick<PrefixedLogger, 'info'> = {
    info: () => {},
  };

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    this._logger = loggers.get('state manager');
    this._functionProfile = ctx.getInstance('functionProfile');
    this._config = ctx.getInstance('config');

    if (this._config.controlPlane.dumpWorkerTrafficStats) {
      this._dumpLogger = new PrefixedLogger('state manager', 'dump');
    }

    this._eventBus = ctx.getInstance('eventBus');
    this._eventBus.subscribe(WorkerTrafficStatsEvent, {
      next: event => {
        return this._syncBrokerData(event.data);
      },
    });
    this._eventBus.subscribe(WorkerStatusReportEvent, {
      next: event => {
        return this._updateWorkerStatusByReport(event);
      },
    });
    this._eventBus.subscribe(ContainerReconciledEvent, {
      next: () => {
        // Do not block reconciliation.
        this._correct();
      },
    });
    this._eventBus.subscribe(FunctionsRemovedEvent, {
      next: async event => {
        await this._removeFunctionProfile(event.data);
      },
    });

    this._statLogger = new StatLogger(this._config);
    this._useEmaScaling = this._config.controlPlane.useEmaScaling;
  }

  _updateWorkerStatusByReport(eve: WorkerStatusReportEvent) {
    const { functionName, name, event, isInspector } = eve.data;

    const broker = this.getBroker(functionName, isInspector);
    const worker = this.getWorker(functionName, isInspector, name);

    if (!broker || !worker) {
      this._logger.warn(
        'containerStatusReport report [%s, %s] skipped because no broker and worker found.',
        functionName,
        name
      );
      return;
    }

    worker.updateWorkerStatusByReport(event as WorkerStatusReport);
  }

  updateFunctionProfile(profiles: RawWithDefaultsFunctionProfile[]) {
    for (const profile of profiles) {
      const brokers = [
        this.getBroker(profile.name, false),
        this.getBroker(profile.name, true),
      ];
      brokers.forEach(it => {
        if (it == null) {
          return;
        }
        it.updateProfile(profile);
      });
    }
  }

  _removeFunctionProfile(names: string[]) {
    let promises: Promise<void>[] = [];
    for (const name of names) {
      const brokers = [this.getBroker(name, false), this.getBroker(name, true)];
      promises = promises.concat(
        brokers.flatMap(broker => {
          if (broker == null) {
            return Promise.resolve();
          }
          return Array.from(broker.workers.values()).map(worker => {
            worker.updateWorkerStatusByControlPlaneEvent(
              ControlPlaneEvent.FunctionRemoved
            );
            return this._tryGC(broker, worker);
          });
        })
      );
    }

    return Promise.all(promises);
  }

  async _syncBrokerData(data: root.noslated.data.IBrokerStats[]) {
    const allSyncData = new Map<string, WorkerStats>();
    const concurrencyStats = new Map<string, number>();

    for (const item of data) {
      const borkerKey = Broker.getKey(item.functionName!, item.inspector!);
      concurrencyStats.set(borkerKey, item.concurrency!);

      this._dumpLogger.info(
        `sync broker %s concurrency %d.`,
        borkerKey,
        item.concurrency!
      );

      for (const workerData of item.workers ?? []) {
        const name = `${borkerKey}#${workerData.name}`;
        allSyncData.set(name, workerData);
      }
    }

    for (const broker of this.brokers()) {
      const brokerKey = Broker.getKey(broker.name, broker.isInspector);

      for (const worker of broker.workers.values()) {
        const name = `${brokerKey}#${worker.name}`;
        worker.sync(allSyncData.get(name) ?? null);
      }

      const concurrency = concurrencyStats.get(brokerKey) ?? 0;
      broker.recalculateConcurrency(concurrency);
    }

    concurrencyStats.clear();
    allSyncData.clear();
  }

  getBroker(functionName: string, isInspector: boolean): Broker | null {
    return this._brokers.get(Broker.getKey(functionName, isInspector)) || null;
  }

  /**
   * Get or create broker by function name and `isInspector`.
   */
  getOrCreateBroker(functionName: string, isInspector: boolean): Broker | null {
    let broker = this.getBroker(functionName, isInspector);
    if (broker) return broker;
    const profile = this._functionProfile.getProfile(functionName);
    if (profile == null) return null;
    broker = new Broker(profile, isInspector, this._useEmaScaling);
    this._brokers.set(Broker.getKey(functionName, isInspector), broker);
    return broker;
  }

  getWorker(
    functionName: string,
    isInspect: boolean,
    workerName: string
  ): Worker | null {
    const broker = this.getBroker(functionName, isInspect);
    if (broker == null) {
      return null;
    }
    return broker.getWorker(workerName);
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
      workerMetadata.options.inspect
    );
    if (!broker) {
      throw new Error(
        `No function named ${workerMetadata.funcName} in function profile.`
      );
    }
    return broker.register(workerMetadata);
  }

  getSnapshot() {
    return [...this._brokers.values()].map(broker => broker.toJSON());
  }

  brokers(): IterableIterator<Broker> {
    return this._brokers.values();
  }

  *workers(): IterableIterator<Worker> {
    for (const broker of this.brokers()) {
      yield* broker.workers.values();
    }
  }

  /**
   * TODO: resource manager
   * Try worker GC.
   * @param {Broker} broker The broker object.
   * @param {Worker} worker The worker object.
   * @return {Promise<void>} The result.
   */
  private async _tryGC(broker: Broker, worker: Worker) {
    if (this._gcWorkers.has(worker)) {
      return;
    }

    // 进入该状态，必然要被 GC
    if (
      worker.workerStatus === WorkerStatus.PendingStop ||
      worker.workerStatus === WorkerStatus.Unknown
    ) {
      this._gcWorkers.add(worker);

      try {
        await worker.container?.stop();
      } catch (e) {
        this._logger.warn(
          `Failed to stop worker [${worker.name}] via \`.#tryGC()\`.`,
          e
        );
      }

      // Do not await as terminating may end up more than seconds.
      this._workerStopped(broker, worker);
    } else if (worker.workerStatus === WorkerStatus.Stopped) {
      this._gcWorkers.add(worker);
      // If the worker is already stopped, clean it up.
      // Do not await as terminating may end up more than seconds.
      this._workerStopped(broker, worker);
    }
  }

  async _workerStopped(broker: Broker, worker: Worker) {
    const state = (await worker.container?.terminated) ?? null;
    if (state) {
      const stime = state['rusage.stime'] ?? 0;
      const utime = state['rusage.utime'] ?? 0;
      //TODO(yilong.lyl): fix typo @zl131478
      const rss = state['rusage.masrss'];

      this._statLogger.exit(
        state.name,
        worker.name,
        state.pid,
        stime + utime,
        rss,
        state.exitcode,
        state['killed.signal'],
        worker.requestId
      );
    }

    worker.updateWorkerStatusByControlPlaneEvent(ControlPlaneEvent.Terminated);

    this._logger.info('%s last state: %j', worker.name, state);
    broker.workers.delete(worker.name);
    this._gcWorkers.delete(worker);

    const event = new WorkerStoppedEvent({
      state,
      registerTime: worker.registerTime,
      functionName: broker.name,
      runtimeType: broker.runtime,
      workerName: worker.name,
    });
    await this._eventBus.publish(event).catch(e => {
      this._logger.error('unexpected error on worker stopped event', e);
    });
  }

  /**
   * Correct synced data (remove GCed items)
   * @return {Promise<void>} The result.
   */
  async _correct() {
    const gcs = [];
    for (const broker of this._brokers.values()) {
      for (const worker of broker.workers.values()) {
        gcs.push(this._tryGC(broker, worker));
      }
    }

    const result = await Promise.allSettled(gcs);
    for (const it of result) {
      if (it.status === 'rejected') {
        this._logger.error('unexpected error on gc', it.reason);
      }
    }

    // TODO: remove obsolete brokers with function profile.
    for (const broker of [...this._brokers.values()]) {
      if (!broker.workers.size) {
        this._brokers.delete(Broker.getKey(broker.name, broker.isInspector));
      }
    }
  }
}
