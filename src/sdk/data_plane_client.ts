import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { BasePlaneClient } from '#self/lib/base_plane_client';
import { Config } from '#self/config';

export class DataPlaneClient extends BasePlaneClient {
  /**
   *
   * @param {number} planeId The plane ID of this client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(planeId: number, config: Config) {
    const heraldPath = path.join(config.dirs.noslatedSock, `dp-${planeId}.sock`);
    super('data plane client', heraldPath, planeId, config);
  }

  async _init() {
    this.addServices([
      (descriptor as any).noslated.data.DataPlane,
      (descriptor as any).noslated.data.PushServer,
    ]);
    return super._init();
  }
}
