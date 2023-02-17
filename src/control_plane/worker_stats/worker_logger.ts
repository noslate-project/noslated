import loggers from '#self/lib/logger';
import { WorkerMetadata } from './worker';
import { Logger } from '#self/lib/loggers';

export class WorkerLogger {
  private logger: Logger;
  private readonly workerMetadata: WorkerMetadata;

  constructor(_workerMetadata: WorkerMetadata) {
    this.workerMetadata = _workerMetadata;
    this.logger = loggers.get(`worker ${this.workerMetadata.processName}`);
  }

  started(cost: number) {
    this.logger.info(
      'worker(%s, %s, inspect %s, disposable %s) started, cost: %s, related request(%s)',
      this.workerMetadata.funcName,
      this.workerMetadata.credential,
      this.workerMetadata.options.inspect,
      this.workerMetadata.disposable,
      cost,
      this.workerMetadata.requestId
    );
  }

  ready(cost: number) {
    this.logger.info(
      'worker(%s, %s, inspect %s, disposable %s) ready, cost: %s, related request(%s)',
      this.workerMetadata.funcName,
      this.workerMetadata.credential,
      this.workerMetadata.options.inspect,
      this.workerMetadata.disposable,
      cost,
      this.workerMetadata.requestId
    );
  }

  statusChangedBeforeReady(status: string) {
    this.logger.info(
      'Worker(%s, %s) status settle to [%s] before pending ready',
      this.workerMetadata.processName,
      this.workerMetadata.credential,
      status
    );
  }

  syncWithNull() {
    this.debug('Sync with null.');
  }

  debug(...args: any[]) {
    this.logger.debug(...args);
  }

  info(...args: any[]) {
    this.logger.info(...args);
  }

  error(...args: any[]) {
    this.logger.error(...args);
  }

  warn(...args: any[]) {
    this.logger.warn(...args);
  }
}
