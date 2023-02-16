import { Logger, loggers } from '#self/lib/loggers';
import { Delta } from '../capacity_manager';
import { BaseController } from './base_controller';
import { ControlPlaneDependencyContext } from '../deps';

export class ReservationController extends BaseController {
  logger: Logger;

  constructor(ctx: ControlPlaneDependencyContext) {
    super(ctx);
    this.logger = loggers.get('reservation controller');
  }

  expand(deltas: Delta[]): Promise<void> {
    return super.expand(deltas);
  }
}
