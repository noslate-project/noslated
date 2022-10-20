import { BaseController } from './controller';
import { ControlPlane } from '../control_plane';
import { Logger, loggers } from '#self/lib/loggers';
import { Delta } from '../capacity_manager';

export class ReservationController extends BaseController {
    logger: Logger;

    constructor(public plane: ControlPlane) {
        super(plane);
        this.logger = loggers.get('reservation controller');
    }

    expand(deltas: Delta[]): Promise<void> {
        return super.expand(deltas);
    }
}