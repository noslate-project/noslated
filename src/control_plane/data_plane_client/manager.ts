import * as _ from 'lodash';
import { BasePlaneClientManager } from '#self/lib/base_plane_client_manager';
import { DataPlaneClient } from './client';
import { loggers } from '#self/lib/loggers';
import { ControlPlane } from '../control_plane';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { RawFunctionProfile } from '#self/lib/json/function_profile';

/**
 * Data plane client manager
 */
export class DataPlaneClientManager extends BasePlaneClientManager {
  constructor(public plane: ControlPlane, public config: Config) {
    super(config, config.plane.dataPlaneCount, loggers.get('data_plane/manager'));
  }

  /**
   * Create a plane client.
   * @param {number} planeId The plane ID.
   * @return {DataPlaneGuest} The created plane client.
   */
  _createPlaneClient(planeId: number): DataPlaneClient {
    return new DataPlaneClient(this, planeId, this.config);
  }

  /**
   *
   * @param {DataPlaneClient} client -
   */
  _onClientReady(client: DataPlaneClient) {
    super._onClientReady(client);

    (client as any).setFunctionProfile({
      profiles: this.plane.get('functionProfile').profile,
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
    const ret: root.noslated.data.ICapacityReductionResponse[] = await this.callToAllAvailableClients('reduceCapacity', [ data ], 'all');
    return _.flatten(ret.filter(data => data.brokers && data.brokers.length).map(data => data.brokers));
  }

  /**
   * Register a worker credential to a random data plane.
   * @param {root.noslated.data.IRegisterWorkerCredentialRequest} msg -
   * @return {Promise<DataPlaneClient>} The selected data plane guest.
   */
  async registerWorkerCredential(msg: root.noslated.data.IRegisterWorkerCredentialRequest) {
    const dp = this.sample();
    if (!dp) {
      throw new Error('No available data plane.');
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
