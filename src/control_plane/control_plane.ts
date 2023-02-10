import { BaseOf } from '#self/lib/sdk_base';
import { dumpConfig, Config } from '#self/config';
import { CapacityManager } from './capacity_manager';
import { CodeManager } from './code_manager';
import { DataPlaneClientManager } from './data_plane_client/manager';
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
import { StateManager } from './worker_stats/state_manager';
import {
  BaseController,
  DisposableController,
  ReservationController,
} from './controllers';
import { Clock, systemClock } from '#self/lib/clock';
import { ContainerManager } from './container/container_manager';
import { TurfContainerManager } from './container/turf_container_manager';

export interface ControlPlaneOptions {
  clock?: Clock;
  containerManager?: ContainerManager;
}

/**
 * ControlPlane
 */
export class ControlPlane extends BaseOf(EventEmitter) {
  clock: Clock;
  containerManager: ContainerManager;
  meter: Meter;
  dataPlaneClientManager: DataPlaneClientManager;
  herald: Herald;
  codeManager: CodeManager;
  functionProfile: FunctionProfileManager;
  workerLauncher: WorkerLauncher;
  capacityManager: CapacityManager;
  workerTelemetry: WorkerTelemetry;
  logger: Logger;
  platformEnvironmentVariables: Record<string, string>;
  stateManager: StateManager;
  controller: BaseController;
  reservationController: ReservationController;
  disposableController: DisposableController;

  constructor(private config: Config, options?: ControlPlaneOptions) {
    super();
    dumpConfig('control', config);

    this.clock = options?.clock ?? systemClock;
    this.containerManager =
      options?.containerManager ?? new TurfContainerManager(config);

    this.meter = getMeter();
    this.dataPlaneClientManager = new DataPlaneClientManager(this, config);
    this.herald = new Herald(this, config);
    this.codeManager = new CodeManager(this.config.dirs.noslatedWork);
    this.functionProfile = new FunctionProfileManager(
      config,
      this.onPresetFunctionProfile.bind(this)
    );
    this.workerLauncher = new WorkerLauncher(this, config);
    this.capacityManager = new CapacityManager(this, config);
    this.workerTelemetry = new WorkerTelemetry(
      this.meter,
      this.capacityManager.workerStatsSnapshot
    );
    this.stateManager = new StateManager(this);
    this.controller = new BaseController(this);
    this.reservationController = new ReservationController(this);
    this.disposableController = new DisposableController(this);

    this.logger = loggers.get('control plane');
    this.platformEnvironmentVariables = {};
  }

  /**
   * Init
   * @return {Promise<void>} The result.
   */
  async _init() {
    this.dataPlaneClientManager.on('newClientReady', plane => {
      this.emit('newDataPlaneClientReady', plane);
    });

    return Promise.all([
      this.containerManager.ready(),
      this.dataPlaneClientManager.ready(),
      this.herald.ready(),
      this.workerLauncher.ready(),
      this.capacityManager.ready(),
    ]);
  }

  /**
   * Close
   * @return {Promise<void>} The result.
   */
  async _close() {
    this.dataPlaneClientManager.removeAllListeners('newClientReady');

    await Promise.all([
      this.dataPlaneClientManager.close(),
      this.herald.close(),
      this.workerLauncher.close(),
      this.capacityManager.close(),
    ]);
    await this.containerManager.close();
    return;
  }

  /**
   * onPresetFunctionProfile
   * @param {any[]} profile The profile array.
   * @param {'IMMEDIATELY' | 'WAIT'} mode The set mode.
   * @return {Promise<void>} The set result.
   */
  async onPresetFunctionProfile(
    profile: RawFunctionProfile[] = [],
    mode: Mode
  ) {
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
