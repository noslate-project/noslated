import { NotNullableInterface } from '#self/lib/interfaces';
import * as root from '#self/proto/root';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { performance } from 'perf_hooks';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';
import { turf } from '#self/lib/turf';

export class StateManager {
  logger: Logger;
  constructor(public plane: ControlPlane) {
    this.logger = loggers.get('state manager');
  }

  updateContainerStatusByReport(report: NotNullableInterface<root.noslated.data.IContainerStatusReport>) {
    const { functionName, name, event, isInspector } = report;

    const broker = this.plane.capacityManager.workerStatsSnapshot.getBroker(functionName, isInspector);
    const worker = this.plane.capacityManager.workerStatsSnapshot.getWorker(functionName, isInspector, name);

    if (!broker || !worker) {
      this.logger.warn('containerStatusReport report [%j] skip because no broker and worker related.', report);
      return;
    }

    // 如果已经 ready，则从 starting pool 中移除
    if (worker.containerStatus === ContainerStatus.Ready) {
      broker.removeItemFromStartingPool(worker.name);
    }

    const statusTo: ContainerStatus = this.#getStatusToByEvent(event);


    if (statusTo === ContainerStatus.Stopped) {
      worker.setStopped();
    }

    if (statusTo === ContainerStatus.Ready && event === ContainerStatusReport.ContainerInstalled) {
      worker.setReady();
    }

    worker.logger.info(`update status to [${ContainerStatus[statusTo]}] from [${ContainerStatus[worker.containerStatus]}] by event [${event}].`);

    // Stopped 和 Unknown 都是终止状态，不允许转向其他状态
    if (worker.containerStatus >= ContainerStatus.Stopped || statusTo < worker.containerStatus) return;

    worker.updateContainerStatus(statusTo, event as ContainerStatusReport);
  }

  #getStatusToByEvent(event: string) {
    if (event === ContainerStatusReport.ContainerInstalled) {
      return ContainerStatus.Ready;
    } else if (event === ContainerStatusReport.RequestDrained || event === ContainerStatusReport.ContainerDisconnected) {
      return ContainerStatus.Stopped;
    } else {
      return ContainerStatus.Unknown;
    }
  }

  async syncWorkerData(data: root.noslated.data.IBrokerStats[]) {
    const psData = await turf.ps();

    if (!psData || psData.length === 0) {
      this.logger.warn('got turf ps data empty, skip current syncWorkerData operation.');
      return;
    }

    this.plane.capacityManager.workerStatsSnapshot.sync(data, psData);
    await this.plane.capacityManager.workerStatsSnapshot.correct();
  }

}
