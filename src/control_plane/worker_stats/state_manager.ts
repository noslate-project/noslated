import { NotNullableInterface } from "#self/lib/interfaces";
import * as root from '#self/proto/root';
import { Worker } from "./worker";
import { ContainerStatus, ContainerStatusReport } from "#self/lib/constants";
import { Broker } from './broker';
import { performance } from 'perf_hooks';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';
import { turf } from '#self/lib/turf';

export class StateManager {
  logger: Logger;
  constructor(public plane: ControlPlane) {
    this.logger = loggers.get('state manager');
  }

  updateContainerStatusByReport(worker: Worker, report: NotNullableInterface<root.noslated.data.IContainerStatusReport>) {

    const { event } = report;

    const statusTo: ContainerStatus = this.#setStatusToByEvent(event);

    worker.logger.info(`update status to [${ContainerStatus[statusTo]}] from [${ContainerStatus[worker.containerStatus]}] by event [${event}].`);

    if (statusTo < worker.containerStatus) return;

    const oldStatus = worker.containerStatus;

    worker.containerStatus = statusTo;

    worker.logger.info(`set new container status [${ContainerStatus[statusTo]}] from [${ContainerStatus[oldStatus]}].`);
  }

  #setStatusToByEvent(event: string) {
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

    const timestamp = performance.now();
    this.plane.capacityManager.workerStatsSnapshot.sync(data, psData);
    await this.plane.capacityManager.workerStatsSnapshot.correct();
  }

}