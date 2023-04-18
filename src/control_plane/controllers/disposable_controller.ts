import { Logger, loggers } from '#self/lib/loggers';
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
    const { functionName, name, isInspector } = eve.data;
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
  }
}
