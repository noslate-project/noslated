import loggers from '#self/lib/logger';
import { pairsToMap, KVPairs } from '#self/lib/rpc/key_value_pair';
import * as root from '#self/proto/root';
import { ServerWritableStream } from '@grpc/grpc-js';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { FunctionProfileManager } from '#self/lib/function_profile';
import {
  FunctionProfileSynchronizedEvent,
  PlatformEnvironsUpdatedEvent,
} from '../events';
import { ControlPlaneDependencyContext } from '../deps';
import { EventBus } from '#self/lib/event-bus';
import { WorkerLauncher } from '../worker_launcher';
import { DataPlaneClientManager } from '../data_plane_client/manager';
import { StateManager } from '../worker_stats/state_manager';

/**
 * Herald impl
 */
export class HeraldImpl {
  private logger;
  private _eventBus: EventBus;
  private _workerLauncher: WorkerLauncher;
  private _functionProfile: FunctionProfileManager;
  private _dataPlaneClientManager: DataPlaneClientManager;
  private _stateManager: StateManager;

  constructor(ctx: ControlPlaneDependencyContext) {
    this.logger = loggers.get('herald impl');
    this._eventBus = ctx.getInstance('eventBus');
    this._workerLauncher = ctx.getInstance('workerLauncher');
    this._functionProfile = ctx.getInstance('functionProfile');
    this._dataPlaneClientManager = ctx.getInstance('dataPlaneClientManager');
    this._stateManager = ctx.getInstance('stateManager');
  }

  /**
   * Set worker environment variables.
   * @param {ServerWritableStream<root.noslated.control.SetPlatformEnvironmentVariablesRequest, root.noslated.control.SetPlatformEnvironmentVariablesResponse>} call The call object.
   * @return {Promise<root.noslated.control.ISetPlatformEnvironmentVariablesResponse>} The result.
   */
  async setPlatformEnvironmentVariables(
    call: ServerWritableStream<
      root.noslated.control.SetPlatformEnvironmentVariablesRequest,
      root.noslated.control.SetPlatformEnvironmentVariablesResponse
    >
  ): Promise<root.noslated.control.ISetPlatformEnvironmentVariablesResponse> {
    const { envs } = call.request;

    this.logger.info('Setting platform environment variables %o.', envs);

    const target = pairsToMap(envs as KVPairs);
    this._eventBus.publish(new PlatformEnvironsUpdatedEvent(target));

    this.logger.info('Platform environment variables set.');

    return {
      set: true,
    };
  }

  /**
   * Set function profile
   * @param {ServerWritableStream<root.noslated.SetFunctionProfileRequest, root.noslated.SetFunctionProfileResponse>} call The call object.
   * @return {Promise<root.noslated.ISetFunctionProfileResponse>} The result.
   */
  async setFunctionProfile(
    call: ServerWritableStream<
      root.noslated.SetFunctionProfileRequest,
      root.noslated.SetFunctionProfileResponse
    >
  ): Promise<root.noslated.ISetFunctionProfileResponse> {
    const { profiles = [], mode } = call.request;
    this.logger.info(
      'Setting function profiles with %s, count: %d',
      mode,
      profiles.length
    );

    try {
      await this._functionProfile.setProfiles(profiles as RawFunctionProfile[]);
      await this._dataPlaneClientManager.setFunctionProfile(
        profiles as RawFunctionProfile[],
        'IMMEDIATELY'
      );
    } catch (e) {
      this.logger.error(
        'Setting function profile fail: %o, profile: %j',
        e,
        profiles
      );
    }

    this._eventBus.publish(new FunctionProfileSynchronizedEvent()).catch(e => {
      this.logger.error(
        'unexpected error on publishing event FunctionProfileSynchronizedEvent',
        e
      );
    });

    return {
      set: true,
    };
  }

  async getFunctionProfile() {
    return {
      profiles: this._functionProfile.getProfiles(),
    };
  }

  /**
   * Get control plane's worker stats snapshot
   * @return {Promise<root.noslated.control.IWorkerStatsSnapshotResponse>} The result.
   */
  async getWorkerStatsSnapshot(): Promise<root.noslated.control.IWorkerStatsSnapshotResponse> {
    return { brokers: this._stateManager.getSnapshot() };
  }

  async checkHealth(): Promise<root.noslated.IPlaneHealthyResponse> {
    // TODO: add health check action
    return {
      name: 'ControlPlane',
      health: true,
      reason: '',
    };
  }
}
