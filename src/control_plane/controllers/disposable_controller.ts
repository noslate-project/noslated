import { performance } from 'perf_hooks';
import { Worker } from '../worker_stats';
import { BaseController } from './controller';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { NotNullableInterface } from '#self/lib/interfaces';
import * as root from '#self/proto/root';

export class DisposableController extends BaseController {
  logger: Logger;

  constructor(public plane: ControlPlane) {
    super(plane);
    this.logger = loggers.get('disposable controller');
  }

  async tryStopDisposableWorkerByReport(
    report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
  ) {
    const { functionName, name, requestId, isInspector, event } = report;
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
        'containerStatusReport report [%o] skip because no broker and worker related.',
        report
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
            `stop worker [${worker.name}] because container status is [${ContainerStatus[worker.containerStatus]
            }] and disposable=true, cost: ${performance.now() - now}.`
          );
        })
        .catch((error) => {
          this.logger.error(
            `stop worker [${worker.name}] because container status is [${ContainerStatus[worker.containerStatus]
            }] and disposable=true failed, wait sync to gc, cost: ${performance.now() - now
            }.`,
            error
          );
          throw error;
        });
    }
  }
}
