import { NotNullableInterface } from '#self/lib/interfaces';
import * as root from '#self/proto/root';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';

export class StateManager {
  logger: Logger;
  containerManager;
  constructor(public plane: ControlPlane) {
    this.logger = loggers.get('state manager');
    this.containerManager = plane.containerManager;
  }

  updateContainerStatusByReport(
    report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
  ) {
    const { functionName, name, event, isInspector } = report;

    const broker = this.plane.capacityManager.workerStatsSnapshot.getBroker(
      functionName,
      isInspector
    );
    const worker = this.plane.capacityManager.workerStatsSnapshot.getWorker(
      functionName,
      isInspector,
      name
    );

    if (!broker || !worker) {
      this.logger.warn(
        'containerStatusReport report [%j] skipped because no broker and worker found.',
        report
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

  async syncWorkerData(data: root.noslated.data.IBrokerStats[]) {
    await this.containerManager.reconcileContainers();
    this.plane.capacityManager.workerStatsSnapshot.sync(data);
    await this.plane.capacityManager.workerStatsSnapshot.correct();
  }
}
