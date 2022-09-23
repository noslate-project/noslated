import { BasePanelClientManager } from '#self/lib/base_panel_client_manager';
import { ControlPanelClient } from './control_panel_client';
import loggers from '#self/lib/logger';
import { AliceClient } from './client';
import { Config } from '#self/config';

/**
 * Control panel client manager
 */
export class ControlPanelClientManager extends BasePanelClientManager {
  /**
   * constructor
   * @param {import('./client').AliceClient} sdk The sdk client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(public sdk: AliceClient, config: Config) {
    super(
      config,
      config.panel.controlPanelCount,
      loggers.get('control panel client manager'));
  }

  /**
   * Create a control panel client.
   * @param {number} panelId The panel ID.
   * @return {ControlPanelClient} The control panel client.
   */
  _createPanelClient(panelId: number) {
    return new ControlPanelClient(panelId, this.config);
  }

  /**
   *
   * @param {ControlPanelClient} client -
   */
  _onClientReady(client: ControlPanelClient) {
    super._onClientReady(client);
    if (this.sdk.functionProfiles == null) {
      return;
    }
    (client as any).setFunctionProfile({
      profiles: this.sdk.functionProfiles,
      mode: this.sdk.functionProfilesMode,
    }).catch((e: unknown) => {
      client.logger.warn(`Cannot set ${client.panelId}'s function profile.`, e);
    });
  }

  /**
   * @deprecated
   * There should just be one single control panel client available.
   * Sampling just doesn't make meaningful sense.
   * Remove this when we figure out an impl that hides connection details.
   * @return {ControlPanelClient} -
   */
  sample() {
    return super.sample();
  }
}
