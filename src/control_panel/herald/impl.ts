import * as _ from 'lodash';
import loggers from '#self/lib/logger';
import { pairsToMap, KVPairs } from '#self/lib/rpc/key_value_pair';
import { Config } from '#self/config';
import { Herald } from './index';
import { ControlPanel } from '../control_panel';
import * as root from '#self/proto/root';
import { ServerWritableStream } from '@grpc/grpc-js';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { Mode } from '#self/lib/function_profile';

/**
 * Herald impl
 */
export class HeraldImpl {
  private parent: Herald;
  private panel: ControlPanel;
  private logger;

  constructor(private config: Config, herald: Herald) {
    this.parent = herald;

    /**
     * @type {import('../control_panel').ControlPanel}
     */
    this.panel = herald.panel;
    this.logger = loggers.get('herald impl');
  }

  /**
   * Set worker environment variables.
   * @param {{ request: import('#self/lib/proto/alice/control-panel').SetPlatformEnvironmentVariablesRequest }} call The call object.
   * @return {Promise<import('#self/lib/proto/alice/common').SetPlatformEnvironmentVariablesResponse>} The result.
   */
  async setPlatformEnvironmentVariables(call: ServerWritableStream<root.alice.control.SetPlatformEnvironmentVariablesRequest, root.alice.control.SetPlatformEnvironmentVariablesResponse>) {
    const { envs } = call.request;

    this.logger.info('Setting platform environment variables %o.', envs);

    const target = pairsToMap(envs as KVPairs);
    this.panel.platformEnvironmentVariables = target;

    this.logger.info('Platform environment variables set.');

    return {
      set: true,
    };
  }

  checkV8Options(profiles: root.alice.IFunctionProfile[]) {
    for (const profile of profiles) {
      const v8Options = profile?.worker?.v8Options || [];

      /**
       * @type {'nodejs'|'aworker'}
       */
      let runtime = profile?.runtime || 'aworker';
      switch (runtime) {
        case 'nodejs-v16': runtime = 'nodejs'; break;
        case 'aworker':
        default:
          runtime = 'aworker'; break;
      }
      this.panel.workerLauncher.starters[runtime].checkV8Options(v8Options);
    }
  }

  /**
   * Set function profile
   * @param {{ request: import('#self/lib/proto/alice/common').SetFunctionProfileRequest }} call The call object.
   * @return {Promise<import('#self/lib/proto/alice/common').SetFunctionProfileResponse>} The result.
   */
  async setFunctionProfile(call: ServerWritableStream<root.alice.SetFunctionProfileRequest, root.alice.SetFunctionProfileResponse>) {
    const orig = this.panel.functionProfile.profile.map(p => p.toJSON());
    const { profiles = [], mode } = call.request;
    this.logger.info('Setting function profiles with %s, count: %d', mode, profiles.length);

    // 验证 worker v8options
    try {
      await this.panel.workerLauncher.ready();
      this.checkV8Options(profiles);
    } catch (e) {
      this.logger.warn('Failed to validate function profile: %o, profile: %j', e, profiles);
      return { set: false };
    }

    let error;
    let dataSet: boolean = false;
    try {
      await this.panel.functionProfile.set(profiles as RawFunctionProfile[], mode as Mode);
      await this.panel.dataPanelClientManager.ready();
      const results = await this.panel.dataPanelClientManager.setFunctionProfile(profiles as RawFunctionProfile[], mode as Mode);
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
        await this.panel.functionProfile.set(orig, 'IMMEDIATELY');
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
    await this.panel.capacityManager.forceDismissAllWorkersInCertainBrokers(killArray);

    return {
      set: true,
    };
  }

  async getFunctionProfile() {
    return {
      profiles: this.panel.functionProfile.profile,
    };
  }

  /**
   * Get control panel's worker stats snapshot
   * @return {Promise<import('#self/lib/proto/alice/control-panel').WorkerStatsSnapshotResponse>} The result.
   */
  async getWorkerStatsSnapshot() {
    const abstract = this.panel.capacityManager.workerStatsSnapshot;
    return { brokers: abstract.toProtobufObject() };
  }
}
