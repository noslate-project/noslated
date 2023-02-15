import loggers from '#self/lib/logger';
import { WorkerInitData } from './worker';
import { Logger } from '#self/lib/loggers';

export class WorkerLogger {
  private logger: Logger;
  private readonly workerInitData: WorkerInitData;

  constructor(_workerInitData: WorkerInitData) {
    this.workerInitData = _workerInitData;
    this.logger = loggers.get(`worker ${this.workerInitData.processName}`);
  }

  started(cost: number) {
    this.logger.info(
      'worker(%s, %s, %s, inspect %s, disposable %s) started, cost: %s, related request(%s)',
      this.workerInitData.funcName,
      this.workerInitData.processName,
      this.workerInitData.credential,
      this.workerInitData.options.inspect,
      this.workerInitData.disposable,
      cost,
      this.workerInitData.requestId
    );
  }

  ready(cost: number) {
    this.logger.info(
      'worker(%s, %s, %s, inspect %s, disposable %s) ready, cost: %s, related request(%s)',
      this.workerInitData.funcName,
      this.workerInitData.processName,
      this.workerInitData.credential,
      this.workerInitData.options.inspect,
      this.workerInitData.disposable,
      cost,
      this.workerInitData.requestId
    );
  }

  already(status: string) {
    this.logger.info(
      'Worker(%s, %s) status settle to [%s] before pending ready',
      this.workerInitData.processName,
      this.workerInitData.credential,
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
