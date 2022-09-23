import { BasePanelClientManager } from '#self/lib/base_panel_client_manager';
import { DataPanelClient } from './data_panel_client';
import loggers from '#self/lib/logger';
import { AliceClient } from './client';
import { Config } from '#self/config';

export class DataPanelClientManager extends BasePanelClientManager {
  /**
   * constructor
   * @param {import('./client').AliceClient} sdk The sdk client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(public sdk: AliceClient, config: Config) {
    super(
      config,
      config.panel.dataPanelCount,
      loggers.get('data panel client manager'));
  }

  /**
   * Create a data panel client.
   * @param {number} panelId The panel ID.
   * @return {DataPanelClient} The created data panel client.
   */
  _createPanelClient(panelId: number) {
    return new DataPanelClient(panelId, this.config);
  }

  /**
   *
   * @param {DataPanelClient} client -
   */
  async _onClientReady(client: DataPanelClient) {
    super._onClientReady(client);
    const promises = [];
    if (this.sdk.daprAdaptorModulePath) {
      promises.push((client as any).setDaprAdaptor({ modulePath: this.sdk.daprAdaptorModulePath }));
    }
    if (this.sdk.serviceProfiles != null) {
      promises.push((client as any).setServiceProfiles({ profiles: this.sdk.serviceProfiles }));
    }

    for (const funcName of this.sdk.useInspectorSet.values()) {
      promises.push((client as any).useInspector(funcName, true));
    }

    const results = await Promise.allSettled(promises);
    for (const rst of results) {
      if (rst.status === 'rejected') {
        client.logger.warn('Failed to setup client.', rst.reason);
      }
    }
  }
}
