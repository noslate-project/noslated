import loggers from '#self/lib/logger';
import { WorkerMetadata } from './worker';
import { Logger } from '#self/lib/loggers';
import {
  WorkerStatus,
  WorkerStatusReport,
  ControlPlaneEvent,
  TurfStatusEvent,
} from '#self/lib/constants';

export class WorkerLogger {
  private logger: Logger;
  private readonly workerMetadata: WorkerMetadata;

  constructor(_workerMetadata: WorkerMetadata) {
    this.workerMetadata = _workerMetadata;
    this.logger = loggers.get('worker');
  }

  start(cost: number) {
    this.logger.info(
      'worker(%s) started, cost: %s, related request(%s)',
      this.workerMetadata.processName,
      cost.toFixed(3),
      this.workerMetadata.requestId
    );
  }

  ready(cost: number) {
    this.logger.info(
      'worker(%s) ready, cost: %s',
      this.workerMetadata.processName,
      cost.toFixed(3)
    );
  }

  updateWorkerStatus(
    to: WorkerStatus,
    from: WorkerStatus,
    event: TurfStatusEvent | WorkerStatusReport | ControlPlaneEvent
  ) {
    this.logger.info(
      'worker(%s) update status [%s] from [%s] by event [%s]',
      this.workerMetadata.processName,
      WorkerStatus[to],
      WorkerStatus[from],
      event
    );
  }

  statusChangedError(e: unknown) {
    this.logger.error(
      'worker(%s) unexpected error on calling onstatuschanged',
      this.workerMetadata.processName,
      e
    );
  }
}
