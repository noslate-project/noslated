import loggers from '#self/lib/logger';
import { WorkerMetadata } from './worker';
import { Logger, LogLevels } from '#self/lib/loggers';
import {
  ContainerStatus,
  ContainerStatusReport,
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

  statusSwitchTo(statusTo: ContainerStatus, reason: string, level?: LogLevels) {
    this.logger[level ?? 'info'](
      'switch worker container status to [%s], because %s.',
      ContainerStatus[statusTo],
      reason
    );
  }

  foundTurfState(state: TurfContainerStates) {
    this.logger.info('found turf state %s.', state);
  }

  updateContainerStatus(
    to: ContainerStatus,
    from: ContainerStatus,
    event: TurfStatusEvent | ContainerStatusReport | ControlPlaneEvent,
    level?: LogLevels,
    extra?: string
  ) {
    this.logger[level ?? 'info'](
      'update container status [%s] from [%s] by event [%s]%s',
      ContainerStatus[to],
      ContainerStatus[from],
      event,
      extra ? extra : '.'
    );
  }
}
