import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { BasePlaneClient } from '#self/lib/base_plane_client';
import { Config } from '#self/config';

/**
 * Control plane client
 */
export class ControlPlaneClient extends BasePlaneClient {
  /**
   * constructor
   * @param {number} planeId The plane ID of this client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(planeId: number, config: Config) {
    const heraldPath = path.join(config.dirs.aliceSock, `cp-${planeId}.sock`);
    super('control plane client', heraldPath, planeId, config);
  }

  /**
   * Init
   * @return {Promise<void>} void
   */
  async _init() {
    this.addService((descriptor as any).alice.control.ControlPlane);
    await super._init();
  }
}
