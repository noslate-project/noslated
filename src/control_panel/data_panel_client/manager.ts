import * as _ from 'lodash';
import { BasePanelClientManager } from '#self/lib/base_panel_client_manager';
import { DataPanelClient } from './client';
import { loggers } from '#self/lib/loggers';
import { ControlPanel } from '../control_panel';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { RawFunctionProfile } from '#self/lib/json/function_profile';

/**
 * Data panel client manager
 */
export class DataPanelClientManager extends BasePanelClientManager {
  constructor(public panel: ControlPanel, public config: Config) {
    super(config, config.panel.dataPanelCount, loggers.get('data_panel/manager'));
  }

  /**
   * Create a panel client.
   * @param {number} panelId The panel ID.
   * @return {DataPanelGuest} The created panel client.
   */
  _createPanelClient(panelId: number): DataPanelClient {
    return new DataPanelClient(this, panelId, this.config);
  }

  /**
   *
   * @param {DataPanelClient} client -
   */
  _onClientReady(client: DataPanelClient) {
    super._onClientReady(client);

    (client as any).setFunctionProfile({
      profiles: this.panel.get('functionProfile').profile,
      mode: 'IMMEDIATELY',
    }).catch(() => { /** ignore */ });
  }

  /**
   * Query for one certain function whether using inspector.
   * @param {string} funcName The function name to be queried.
   * @return {boolean} Whether used or not.
   */
  async isUsingInspector(funcName: string) {
    const dp = this.sample();
    if (!dp) {
      return false;
    }

    const ret = await (dp as any).isUsingInspector({ funcName });
    return ret.use;
  }

  /**
   * Send a reduce capacity command to all clients.
   * @param {object} data The data to be reduced.
   * @return {object} Containers that can be reduced.
   */
  async reduceCapacity(data: any): Promise<any[]> {
    const ret: root.alice.data.ICapacityReductionResponse[] = await this.callToAllAvailableClients('reduceCapacity', [ data ], 'all');
    return _.flatten(ret.filter(data => data.brokers && data.brokers.length).map(data => data.brokers));
  }

  /**
   * Register a worker credential to a random data panel.
   * @param {import('#self/lib/proto/alice/data-panel').RegisterWorkerCredentialRequest} msg -
   * @return {Promise<DataPanelClient>} The selected data panel guest.
   */
  async registerWorkerCredential(msg: root.alice.data.IRegisterWorkerCredentialRequest) {
    const dp = this.sample();
    if (!dp) {
      throw new Error('No available data panel.');
    }

    await (dp as any).registerWorkerCredential(msg);
    return dp;
  }

  /**
   * Set function profile.
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile[]} profile The function profile.
   * @param {'IMMEDIATELY' | 'WAIT'} mode The set mode.
   * @return {Promise<({ set: boolean })[]>} The set result.
   */
  async setFunctionProfile(profile: RawFunctionProfile[], mode: SetFunctionProfileMode): Promise<SetFunctionProfileResult[]> {
    return await this.callToAllAvailableClients('setFunctionProfile', [{
      profiles: profile,
      mode,
    }], 'all');
  }
}

type SetFunctionProfileMode = 'IMMEDIATELY' | 'WAIT';
interface SetFunctionProfileResult {
  set: boolean;
}