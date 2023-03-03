import { Config } from '#self/config';
import { Clock } from '#self/lib/clock';
import { DependencyContext } from '#self/lib/dependency_context';
import { Logger, loggers } from '#self/lib/loggers';
import { createDeferred } from '#self/lib/util';
import { ContainerManager } from './container_manager';

export type ReconcilerContext = {
  config: Config;
  clock: Clock;
  containerManager: ContainerManager;
};

export class ContainerReconciler {
  private _reconcilingInterval: number;
  private _clock: Clock;
  private _containerManager: ContainerManager;
  private _logger: Logger;
  private _interval: unknown | null = null;
  private _closed = false;

  private _nextReconcileDeferred = createDeferred<void>();

  constructor(ctx: DependencyContext<ReconcilerContext>) {
    this._clock = ctx.getInstance('clock');
    this._reconcilingInterval =
      ctx.getInstance('config').turf.reconcilingInterval;
    this._containerManager = ctx.getInstance('containerManager');
    this._logger = loggers.get('container reconciler');
  }

  ready() {
    this._reschedule();
  }

  close() {
    this._closed = true;
    this._clock.clearTimeout(this._interval);
  }

  reconcile() {
    this._execute();
    return this._nextReconcileDeferred.promise;
  }

  private _reschedule() {
    this._clock.clearTimeout(this._interval);
    this._nextReconcileDeferred.resolve();
    if (this._closed) {
      return;
    }
    this._nextReconcileDeferred = createDeferred();

    this._interval = this._clock.setTimeout(
      this._execute,
      this._reconcilingInterval
    );
  }

  private _execute = () => {
    this._logger.debug('initiating container reconciliation');

    this._clock.clearTimeout(this._interval);
    this._containerManager
      .reconcileContainers()
      .catch(err => {
        this._logger.error('unexpected error on reconciliation', err);
      })
      .finally(() => {
        this._reschedule();
      });
  };
}
