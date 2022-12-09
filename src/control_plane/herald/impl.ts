import * as _ from 'lodash';
import loggers from '#self/lib/logger';
import { pairsToMap, KVPairs } from '#self/lib/rpc/key_value_pair';
import { Config } from '#self/config';
import { Herald } from './index';
import { ControlPlane } from '../control_plane';
import * as root from '#self/proto/root';
import { ServerWritableStream } from '@grpc/grpc-js';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { Mode } from '#self/lib/function_profile';

/**
 * Herald impl
 */
export class HeraldImpl {
  private parent: Herald;
  private plane: ControlPlane;
  private logger;

  constructor(private config: Config, herald: Herald) {
    this.parent = herald;

    /**
     * @type {import('../control_plane').ControlPlane}
     */
    this.plane = herald.plane;
    this.logger = loggers.get('herald impl');
  }

  /**
   * Set worker environment variables.
   * @param {ServerWritableStream<root.noslated.control.SetPlatformEnvironmentVariablesRequest, root.noslated.control.SetPlatformEnvironmentVariablesResponse>} call The call object.
   * @return {Promise<root.noslated.control.ISetPlatformEnvironmentVariablesResponse>} The result.
   */
  async setPlatformEnvironmentVariables(call: ServerWritableStream<root.noslated.control.SetPlatformEnvironmentVariablesRequest, root.noslated.control.SetPlatformEnvironmentVariablesResponse>): Promise<root.noslated.control.ISetPlatformEnvironmentVariablesResponse> {
    const { envs } = call.request;

    this.logger.info('Setting platform environment variables %o.', envs);

    const target = pairsToMap(envs as KVPairs);
    this.plane.platformEnvironmentVariables = target;

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
        case 'nodejs': runtime = 'nodejs'; break;
        case 'aworker':
        default:
          runtime = 'aworker'; break;
      }
      this.plane.workerLauncher.starters[runtime].checkV8Options(v8Options);
    }
  }

  /**
   * Set function profile
   * @param {ServerWritableStream<root.noslated.SetFunctionProfileRequest, root.noslated.SetFunctionProfileResponse>} call The call object.
   * @return {Promise<root.noslated.ISetFunctionProfileResponse>} The result.
   */
  async setFunctionProfile(call: ServerWritableStream<root.noslated.SetFunctionProfileRequest, root.noslated.SetFunctionProfileResponse>): Promise<root.noslated.ISetFunctionProfileResponse> {
    const orig = this.plane.functionProfile.profile.map(p => p.toJSON());
    const { profiles = [], mode } = call.request;
    this.logger.info('Setting function profiles with %s, count: %d', mode, profiles.length);

    // 验证 worker v8options
    try {
      await this.plane.workerLauncher.ready();
      this.checkV8Options(profiles);
    } catch (e) {
      this.logger.warn('Failed to validate function profile: %o, profile: %j', e, profiles);
      return { set: false };
    }

    let error;
    let dataSet = false;
    try {
      await this.plane.functionProfile.set(profiles as RawFunctionProfile[], mode as Mode);
      await this.plane.dataPlaneClientManager.ready();
      const results = await this.plane.dataPlaneClientManager.setFunctionProfile(profiles as RawFunctionProfile[], mode as Mode);
      if (!results.length) dataSet = true;
      else {
        dataSet = results.reduce<boolean>((ans, item) => {
          return ans || item.set;
        }, dataSet);
      }
    } catch (e) {
      error = e;
      this.logger.warn('Setting function profile fail: %o, profile: %j', e, profiles);
    }

    if (error || !dataSet) {
      try {
        await this.plane.functionProfile.set(orig, 'IMMEDIATELY');
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
    await this.plane.controller.stopAllWorkers(killArray);

    return {
      set: true,
    };
  }

  async getFunctionProfile() {
    return {
      profiles: this.plane.functionProfile.profile,
    };
  }

  /**
   * Get control plane's worker stats snapshot
   * @return {Promise<root.noslated.control.IWorkerStatsSnapshotResponse>} The result.
   */
  async getWorkerStatsSnapshot(): Promise<root.noslated.control.IWorkerStatsSnapshotResponse> {
    const abstract = this.plane.capacityManager.workerStatsSnapshot;
    return { brokers: abstract.toProtobufObject() };
  }
}
