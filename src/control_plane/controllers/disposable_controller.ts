import { performance } from 'perf_hooks';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { WorkerStatusReportEvent } from '../events';
import { BaseController } from './base_controller';

export class DisposableController extends BaseController {
  logger: Logger;

  constructor(plane: ControlPlane) {
    super(plane);
    this.logger = loggers.get('disposable controller');

    this.plane.eventBus.subscribe(WorkerStatusReportEvent, {
      next: event => {
        return this.tryStopDisposableWorkerByReport(event);
      },
    });
  }

  async tryStopDisposableWorkerByReport(eve: WorkerStatusReportEvent) {
    const { functionName, name, requestId, isInspector, event } = eve.data;
    const broker = this.plane.stateManager.getBroker(functionName, isInspector);
    const worker = this.plane.stateManager.getWorker(
      functionName,
      isInspector,
      name
    );

    if (!broker || !worker) {
      this.logger.warn(
        'containerStatusReport report [%s, %s] skip because no broker and worker related.',
        functionName,
        name
      );
      return;
    }

    if (
      event === ContainerStatusReport.RequestDrained &&
      worker.containerStatus === ContainerStatus.Stopped &&
      worker.disposable
    ) {
      // wait next sync to gc worker data and related resources
      const now = performance.now();

      worker.requestId = requestId;

      this.stopWorker(worker.name, requestId)
        .then(() => {
          this.logger.info(
            `stop worker [${worker.name}] because container status is [${
              ContainerStatus[worker.containerStatus]
            }] and disposable=true, cost: ${performance.now() - now}.`
          );
        })
        .catch(error => {
          this.logger.error(
            `stop worker [${worker.name}] because container status is [${
              ContainerStatus[worker.containerStatus]
            }] and disposable=true failed, wait sync to gc, cost: ${
              performance.now() - now
            }.`,
            error
          );
          throw error;
        });
    }
  }
}
