import * as _ from 'lodash';
import loggers from '#self/lib/logger';
import { pairsToMap, KVPairs } from '#self/lib/rpc/key_value_pair';
import * as root from '#self/proto/root';
import { ServerWritableStream } from '@grpc/grpc-js';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { FunctionProfileManager, Mode } from '#self/lib/function_profile';
import { FunctionRemovedEvent, PlatformEnvironsUpdatedEvent } from '../events';
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

  checkV8Options(profiles: root.noslated.IFunctionProfile[]) {
    for (const profile of profiles) {
      const v8Options = profile?.worker?.v8Options || [];

      /**
       * @type {'nodejs'|'aworker'}
       */
      let runtime = profile?.runtime || 'aworker';
      switch (runtime) {
        case 'nodejs':
          runtime = 'nodejs';
          break;
        case 'aworker':
        default:
          runtime = 'aworker';
          break;
      }
      this._workerLauncher.starters[runtime].checkV8Options(v8Options);
    }
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
    const orig = this._functionProfile.profile.map(p => p.toJSON());
    const { profiles = [], mode } = call.request;
    this.logger.info(
      'Setting function profiles with %s, count: %d',
      mode,
      profiles.length
    );

    // 验证 worker v8options
    try {
      await this._workerLauncher.ready();
      this.checkV8Options(profiles);
    } catch (e) {
      this.logger.warn(
        'Failed to validate function profile: %o, profile: %j',
        e,
        profiles
      );
      return { set: false };
    }

    let error;
    let dataSet = false;
    try {
      await this._functionProfile.set(
        profiles as RawFunctionProfile[],
        mode as Mode
      );
      await this._dataPlaneClientManager.ready();
      const results = await this._dataPlaneClientManager.setFunctionProfile(
        profiles as RawFunctionProfile[],
        mode as Mode
      );
      if (!results.length) dataSet = true;
      else {
        dataSet = results.reduce<boolean>((ans, item) => {
          return ans || item.set;
        }, dataSet);
      }
    } catch (e) {
      error = e;
      this.logger.warn(
        'Setting function profile fail: %o, profile: %j',
        e,
        profiles
      );
    }

    if (error || !dataSet) {
      try {
        await this._functionProfile.set(orig, 'IMMEDIATELY');
      } catch (e) {
        this.logger.warn('Failed to rollback function profile.', e);
      }
      return { set: false };
    }

    // compare current to original profiles, kill updated containers.
    // TODO(kaidi.zkd): reduce comparation `for`. e.g. sort first.
    const killArray: string[] = [];
    for (const item of profiles) {
      const origItem = _.find(orig, o => o.name === item.name);
      if (origItem === undefined) continue;

      // keys below are effected keys
      const keys = [
        'runtime',
        'url',
        'signature',
        'sourceFile',
        'handler',
        'initializer',
        'resourceLimit.cpu',
        'resourceLimit.memory',
      ];
      let shouldKill = false;
      for (const key of keys) {
        const a = _.get(item, key);
        const b = _.get(origItem, key);
        if (a !== b) {
          shouldKill = true;
          break;
        }
      }

      if (shouldKill) killArray.push(item.name as string);
    }

    // Do kill all workers in brokers.
    const event = new FunctionRemovedEvent(killArray);
    await this._eventBus.publish(event);

    return {
      set: true,
    };
  }

  async getFunctionProfile() {
    return {
      profiles: this._functionProfile.profile,
    };
  }

  /**
   * Get control plane's worker stats snapshot
   * @return {Promise<root.noslated.control.IWorkerStatsSnapshotResponse>} The result.
   */
  async getWorkerStatsSnapshot(): Promise<root.noslated.control.IWorkerStatsSnapshotResponse> {
    return { brokers: this._stateManager.getSnapshot() };
  }
}
