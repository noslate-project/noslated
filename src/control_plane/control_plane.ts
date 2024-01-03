import { BaseOf } from '#self/lib/sdk_base';
import { dumpConfig } from '#self/config';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { EventEmitter } from 'events';
import { WorkerTelemetry } from './telemetry';
import { getMeter } from '#self/lib/telemetry/otel';
import { Meter } from '@opentelemetry/api';
import {
  ConfigurableControlPlaneDeps,
  ControlPlaneDependencyContext,
} from './deps';
import { EventBus } from '#self/lib/event-bus';
import { StateManager } from './worker_stats/state_manager';
import { CodeManager } from './code_manager';
import { FunctionProfileUpdateEvent } from '#self/lib/function_profile';

/**
 * ControlPlane
 */
export class ControlPlane extends BaseOf(EventEmitter) {
  /**
   * @internal
   * Public for testing.
   */
  public _ctx: ControlPlaneDependencyContext;

  private _meter: Meter;
  private _logger: Logger;
  private _workerTelemetry: WorkerTelemetry;
  private _eventBus: EventBus;
  private _stateManager: StateManager;
  private _codeManager: CodeManager;

  constructor(deps?: ConfigurableControlPlaneDeps) {
    super();

    this._ctx = new ControlPlaneDependencyContext(deps);

    dumpConfig('control', this._ctx.getInstance('config'));

    this._eventBus = this._ctx.getInstance('eventBus');
    this._stateManager = this._ctx.getInstance('stateManager');
    this._codeManager = this._ctx.getInstance('codeManager');

    this._meter = getMeter();
    this._workerTelemetry = new WorkerTelemetry(
      this._meter,
      this._stateManager,
      this._eventBus
    );

    this._logger = loggers.get('control plane');

    this._ctx
      .getInstance('dataPlaneClientManager')
      .on('newClientReady', plane => {
        this.emit('newDataPlaneClientReady', plane);
      });
    this._eventBus.subscribe(FunctionProfileUpdateEvent, {
      next: event => {
        return this._onPresetFunctionProfile(event);
      },
    });
  }

  /**
   * Init
   * @return {Promise<void>} The result.
   */
  async _init() {
    await this._ctx.bootstrap();
  }

  /**
   * Close
   * @return {Promise<void>} The result.
   */
  async _close() {
    await this._ctx.dispose();
    loggers.close();
  }

  private async _onPresetFunctionProfile(event: FunctionProfileUpdateEvent) {
    this._stateManager.updateFunctionProfile(event.data);

    const promises = event.data.map(({ name, url, signature }) => {
      return this._codeManager.ensure(name, url, signature);
    });

    const result = await Promise.allSettled(promises);
    for (const r of result) {
      if (r.status === 'rejected') {
        this._logger.warn('Failed to ensure profile:', r.reason);
      }
    }
  }
}
