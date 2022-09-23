import { BaseOf } from '#self/lib/sdk_base';
import { dumpConfig, Config } from '#self/config';
import { CapacityManager } from './capacity_manager';
import { CodeManager } from './code_manager';
import { DataPanelClientManager } from './data_panel_client/manager';
import { FunctionProfileManager, Mode } from '#self/lib/function_profile';
import { Herald } from './herald';
import loggers from '#self/lib/logger';
import { Logger } from '#self/lib/loggers';
import { WorkerLauncher } from './worker_launcher';
import { EventEmitter } from 'events';
import { WorkerTelemetry } from './telemetry';
import { getMeter } from '#self/lib/telemetry/otel';
import { Meter } from '@opentelemetry/api';
import { RawFunctionProfile } from '#self/lib/json/function_profile';

/**
 * ControlPanel
 */
export class ControlPanel extends BaseOf(EventEmitter) {

  meter: Meter;
  dataPanelClientManager: DataPanelClientManager;
  herald: Herald;
  codeManager: CodeManager;
  functionProfile: FunctionProfileManager;
  workerLauncher: WorkerLauncher;
  capacityManager: CapacityManager;
  workerTelemetry: WorkerTelemetry;
  logger: Logger;
  platformEnvironmentVariables: Record<string, string>;

  constructor(private config: Config) {
    super();
    dumpConfig('control', config);

    this.meter = getMeter();
    this.dataPanelClientManager = new DataPanelClientManager(this, config);
    this.herald = new Herald(this, config);
    this.codeManager = new CodeManager(this.config.dirs.aliceWork);
    this.functionProfile = new FunctionProfileManager(config, this.onPresetFunctionProfile.bind(this));
    this.workerLauncher = new WorkerLauncher(this, config);
    this.capacityManager = new CapacityManager(this, config);
    this.workerTelemetry = new WorkerTelemetry(this.meter, this.capacityManager.workerStatsSnapshot);

    this.logger = loggers.get('control panel');
    this.platformEnvironmentVariables = {};
  }

  /**
   * Init
   * @return {Promise<void>} The result.
   */
  async _init() {
    this.dataPanelClientManager.on('newClientReady', panel => {
      this.emit('newDataPanelClientReady', panel);
    });

    return Promise.all([
      this.dataPanelClientManager.ready(),
      this.herald.ready(),
      this.workerLauncher.ready(),
      this.capacityManager.ready(),
    ]);
  }

  /**
   * Close
   * @return {Promise<void>} The result.
   */
  _close() {
    this.dataPanelClientManager.removeAllListeners('newClientReady');

    return Promise.all([
      this.dataPanelClientManager.close(),
      this.herald.close(),
      this.workerLauncher.close(),
      this.capacityManager.close(),
    ]);
  }

  /**
   * @deprecated should not expose internal component with dynamic getter.
   * Get a component of control panel.
   * @param {string} componentName The component name.
   * @return {any} The component.
   */
  get(componentName: string) {
    return this[componentName] || null;
  }

  /**
   * onPresetFunctionProfile
   * @param {any[]} profile The profile array.
   * @param {'IMMEDIATELY' | 'WAIT'} mode The set mode.
   * @return {Promise<void>} The set result.
   */
  async onPresetFunctionProfile(profile: RawFunctionProfile[] = [], mode: Mode) {
    const promises = profile.map(({ name, url, signature }) => {
      return this.codeManager.ensure(name, url, signature);
    });

    const promise = Promise.allSettled(promises).then(ret => {
      for (const r of ret) {
        if (r.status === 'rejected') {
          this.logger.warn('Failed to ensure profile:', r.reason);
        }
      }
    });

    if (mode === 'WAIT') await promise;
  }
}
