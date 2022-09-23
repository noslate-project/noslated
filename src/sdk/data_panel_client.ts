import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { BasePanelClient } from '#self/lib/base_panel_client';
import { Config } from '#self/config';

export class DataPanelClient extends BasePanelClient {
  /**
   *
   * @param {number} panelId The panel ID of this client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(panelId: number, config: Config) {
    const heraldPath = path.join(config.dirs.aliceSock, `dp-${panelId}.sock`);
    super('data panel client', heraldPath, panelId, config);
  }

  async _init() {
    this.addServices([
      (descriptor as any).alice.data.DataPanel,
      (descriptor as any).alice.data.PushServer,
    ]);
    return super._init();
  }
}
