import { Delta } from '../capacity_manager';
import { BaseController } from './base_controller';
import { ControlPlaneDependencyContext } from '../deps';
import { LoggerFactory, PrefixedLogger } from '#self/lib/logger_factory';

export class ReservationController extends BaseController {
  logger: PrefixedLogger;

  constructor(ctx: ControlPlaneDependencyContext) {
    super(ctx);
    this.logger = LoggerFactory.prefix('reservation controller');
  }

  expand(deltas: Delta[]): Promise<void> {
    return super.expand(deltas);
  }
}
