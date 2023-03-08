import { performance } from 'perf_hooks';
import { Logger, loggers } from '#self/lib/loggers';
import { WorkerStatus, WorkerStatusReport } from '#self/lib/constants';
import { WorkerStatusReportEvent } from '../events';
import { BaseController } from './base_controller';
import { ControlPlaneDependencyContext } from '../deps';

export class DisposableController extends BaseController {
  logger: Logger;

  constructor(ctx: ControlPlaneDependencyContext) {
    super(ctx);
    this.logger = loggers.get('disposable controller');

    const eventBus = ctx.getInstance('eventBus');
    eventBus.subscribe(WorkerStatusReportEvent, {
      next: event => {
        return this.tryStopDisposableWorkerByReport(event);
      },
    });
  }

  async tryStopDisposableWorkerByReport(eve: WorkerStatusReportEvent) {
    const { functionName, name, requestId, isInspector, event } = eve.data;
    const broker = this._stateManager.getBroker(functionName, isInspector);
    const worker = this._stateManager.getWorker(
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
      event === WorkerStatusReport.RequestDrained &&
      worker.workerStatus === WorkerStatus.Stopped &&
      worker.disposable
    ) {
      // wait next sync to gc worker data and related resources
      const now = performance.now();

      worker.requestId = requestId;

      this.stopWorker(worker.name, requestId)
        .then(() => {
          this.logger.info(
            `stop worker [${worker.name}] because container status is [${
              WorkerStatus[worker.workerStatus]
            }] and disposable=true, cost: ${performance.now() - now}.`
          );
        })
        .catch(error => {
          this.logger.error(
            `stop worker [${worker.name}] because container status is [${
              WorkerStatus[worker.workerStatus]
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
