import * as root from '#self/proto/root';
import { WorkerStatus, WorkerStatusReport } from '#self/lib/constants';
import { Logger, loggers } from '#self/lib/loggers';
import {
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
  WorkerTrafficStatsEvent,
} from '../events';
import { WorkerStatsSnapshot } from './snapshot';
import { Config } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { Broker } from './broker';
import { Worker } from './worker';
import { TurfState } from '#self/lib/turf/types';
import { ControlPlaneDependencyContext } from '../deps';

export class StateManager extends Base {
  private logger: Logger;
  private config: Config;
  private functionProfile;
  private reconciler;
  workerStatsSnapshot: WorkerStatsSnapshot;

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    this.logger = loggers.get('state manager');
    this.functionProfile = ctx.getInstance('functionProfile');
    this.reconciler = ctx.getInstance('containerReconciler');
    this.config = ctx.getInstance('config');

    this.workerStatsSnapshot = new WorkerStatsSnapshot(
      ctx.getInstance('functionProfile'),
      this.config
    );
    const eventBus = ctx.getInstance('eventBus');

    this.workerStatsSnapshot.on(
      'workerStopped',
      (state: TurfState | null, broker: Broker, worker: Worker) => {
        const event = new WorkerStoppedEvent({
          state,
          functionName: broker.name,
          runtimeType: broker.data?.runtime!,
          workerName: worker.name,
        });
        eventBus.publish(event).catch(e => {
          this.logger.error('unexpected error on worker stopped event', e);
        });
      }
    );

    eventBus.subscribe(WorkerTrafficStatsEvent, {
      next: event => {
        return this.syncWorkerData(event.data.brokers);
      },
    });
    eventBus.subscribe(WorkerStatusReportEvent, {
      next: event => {
        return this.updateWorkerStatusByReport(event);
      },
    });
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

  updateWorkerStatusByReport(eve: WorkerStatusReportEvent) {
    const { functionName, name, event, isInspector } = eve.data;

    const broker = this.workerStatsSnapshot.getBroker(
      functionName,
      isInspector
    );
    const worker = this.workerStatsSnapshot.getWorker(
      functionName,
      isInspector,
      name
    );

    if (!broker || !worker) {
      this.logger.warn(
        'containerStatusReport report [%s, %s] skipped because no broker and worker found.',
        functionName,
        name
      );
      return;
    }

    // 如果已经 ready，则从 starting pool 中移除
    if (worker.workerStatus === WorkerStatus.Ready) {
      broker.removeItemFromStartingPool(worker.name);
    }

    worker.updateWorkerStatusByReport(event as WorkerStatusReport);
  }

  updateFunctionProfile() {
    // 创建 brokers
    const { reservationCountPerFunction } = this.config.worker;
    for (const profile of this.functionProfile.profile) {
      const reservationCount = profile?.worker?.reservationCount;
      if (reservationCount === 0) continue;
      if (reservationCount || reservationCountPerFunction) {
        this.workerStatsSnapshot.getOrCreateBroker(
          profile.name,
          false,
          profile.worker?.disposable
        );
      }
    }
  }

  async syncWorkerData(data: root.noslated.data.IBrokerStats[]) {
    await this.reconciler.reconcile();
    this.workerStatsSnapshot.sync(data);
    await this.workerStatsSnapshot.correct();
  }

  getBroker(functionName: string, isInspect: boolean): Broker | null {
    return this.workerStatsSnapshot.getBroker(functionName, isInspect);
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

  getSnapshot() {
    return this.workerStatsSnapshot.toProtobufObject();
  }

  brokers(): IterableIterator<Broker> {
    return this.workerStatsSnapshot.brokers.values();
  }

  *workers(): IterableIterator<Worker> {
    for (const broker of this.brokers()) {
      yield* broker.workers.values();
    }
  }
}
