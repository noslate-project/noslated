import loggers from '#self/lib/logger';
import { WorkerMetadata } from './worker';
import { Logger, LogLevels } from '#self/lib/loggers';
import {
  WorkerStatus,
  WorkerStatusReport,
  ControlPlaneEvent,
  TurfStatusEvent,
} from '#self/lib/constants';
import { TurfContainerStates } from '#self/lib/turf';

export class WorkerLogger {
  private logger: Logger;
  private readonly workerMetadata: WorkerMetadata;

  constructor(_workerMetadata: WorkerMetadata) {
    this.workerMetadata = _workerMetadata;
    this.logger = loggers.get(`worker ${this.workerMetadata.processName}`);
  }

  start(cost: number) {
    this.logger.info(
      'worker(%s, %s, inspect %s, disposable %s) started, cost: %s, related request(%s)',
      this.workerMetadata.funcName,
      this.workerMetadata.credential,
      this.workerMetadata.options.inspect,
      this.workerMetadata.disposable,
      cost.toFixed(3),
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
      cost.toFixed(3),
      this.workerMetadata.requestId
    );
  }

  statusChangedBeforeReady(status: string) {
    this.logger.info(
      'Worker(%s) status settle to [%s] before pending ready.',
      this.workerMetadata.credential,
      status
    );
  }

  statusSwitchTo(statusTo: WorkerStatus, reason: string, level?: LogLevels) {
    this.logger[level ?? 'info'](
      'switch worker container status to [%s], because %s.',
      WorkerStatus[statusTo],
      reason
    );
  }

  foundTurfState(state: TurfContainerStates) {
    this.logger.info('found turf state %s.', state);
  }

  updateContainerStatus(
    to: WorkerStatus,
    from: WorkerStatus,
    event: TurfStatusEvent | WorkerStatusReport | ControlPlaneEvent,
    level?: LogLevels,
    extra?: string
  ) {
    this.logger[level ?? 'info'](
      'update container status [%s] from [%s] by event [%s]%s',
      WorkerStatus[to],
      WorkerStatus[from],
      event,
      extra ? extra : '.'
    );
  }
}
