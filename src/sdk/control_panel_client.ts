import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { BasePanelClient } from '#self/lib/base_panel_client';
import { Config } from '#self/config';

/**
 * Control panel client
 */
export class ControlPanelClient extends BasePanelClient {
  /**
   * constructor
   * @param {number} panelId The panel ID of this client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(panelId: number, config: Config) {
    const heraldPath = path.join(config.dirs.aliceSock, `cp-${panelId}.sock`);
    super('control panel client', heraldPath, panelId, config);
  }

  /**
   * Init
   * @return {Promise<void>} void
   */
  async _init() {
    this.addService((descriptor as any).alice.control.ControlPanel);
    await super._init();
  }
}
