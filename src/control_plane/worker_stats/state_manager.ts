import * as root from '#self/proto/root';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { ControlPlane } from '../control_plane';
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

export class StateManager extends Base {
  logger: Logger;
  functionProfile;
  containerManager;
  workerStatsSnapshot;

  constructor(plane: ControlPlane, private config: Config) {
    super();
    this.logger = loggers.get('state manager');
    this.functionProfile = plane.functionProfile;
    this.containerManager = plane.containerManager;

    this.workerStatsSnapshot = new WorkerStatsSnapshot(
      plane.functionProfile,
      config,
      plane.clock
    );

    this.workerStatsSnapshot.on(
      'workerStopped',
      (
        emitExceptionMessage: string | undefined,
        state: TurfState | null,
        broker: Broker
      ) => {
        const event = new WorkerStoppedEvent({
          emitExceptionMessage,
          state,
          broker,
        });
        plane.eventBus.publish(event).catch(e => {
          this.logger.error('unexpected error on worker stopped event', e);
        });
      }
    );

    plane.eventBus.subscribe(WorkerTrafficStatsEvent, {
      next: event => {
        return this.syncWorkerData(event.data.brokers);
      },
    });
    plane.eventBus.subscribe(WorkerStatusReportEvent, {
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
    if (worker.containerStatus === ContainerStatus.Ready) {
      broker.removeItemFromStartingPool(worker.name);
    }

    const statusTo: ContainerStatus = this.#getStatusToByEvent(event);

    // Stopped 和 Unknown 都是终止状态，不允许转向其他状态
    if (worker.containerStatus >= ContainerStatus.Stopped) return;

    worker.updateContainerStatus(statusTo, event as ContainerStatusReport);

    if (statusTo === ContainerStatus.Stopped) {
      worker.setStopped();
    }

    if (
      statusTo === ContainerStatus.Ready &&
      event === ContainerStatusReport.ContainerInstalled
    ) {
      worker.setReady();
    }
  }

  #getStatusToByEvent(event: string) {
    if (event === ContainerStatusReport.ContainerInstalled) {
      return ContainerStatus.Ready;
    } else if (
      event === ContainerStatusReport.RequestDrained ||
      event === ContainerStatusReport.ContainerDisconnected
    ) {
      return ContainerStatus.Stopped;
    } else {
      return ContainerStatus.Unknown;
    }
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
    await this.containerManager.reconcileContainers();
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
