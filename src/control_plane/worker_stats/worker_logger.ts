import loggers from '#self/lib/logger';
import { WorkerMetadata } from './worker';
import { Logger, LogLevels } from '#self/lib/loggers';
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
      'worker(%s, %s, inspect %s) started, cost: %s, related request(%s)',
      this.workerMetadata.funcName,
      this.workerMetadata.processName,
      this.workerMetadata.options.inspect,
      cost.toFixed(3),
      this.workerMetadata.requestId
    );
  }

  ready(cost: number) {
    this.logger.info(
      'worker(%s, %s, inspect %s) ready, cost: %s, related request(%s)',
      this.workerMetadata.funcName,
      this.workerMetadata.processName,
      this.workerMetadata.options.inspect,
      cost.toFixed(3),
      this.workerMetadata.requestId
    );
  }

  statusChangedBeforeReady(status: string) {
    this.logger.info(
      'Worker(%s) status settle to [%s] before pending ready.',
      this.workerMetadata.processName,
      status
    );
  }

  updateWorkerStatus(
    to: WorkerStatus,
    from: WorkerStatus,
    event: TurfStatusEvent | WorkerStatusReport | ControlPlaneEvent,
    level?: LogLevels,
    extra?: string
  ) {
    this.logger[level ?? 'info'](
      'update worker status [%s] from [%s] by event [%s]%s',
      WorkerStatus[to],
      WorkerStatus[from],
      event,
      extra ? extra : '.'
    );
  }

  statusChangedError(e: unknown) {
    this.logger.error('unexpected error on calling onstatuschanged', e);
  }
}
