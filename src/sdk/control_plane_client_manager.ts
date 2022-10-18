import { BasePlaneClientManager } from '#self/lib/base_plane_client_manager';
import { ControlPlaneClient } from './control_plane_client';
import loggers from '#self/lib/logger';
import { NoslatedClient } from './client';
import { Config } from '#self/config';

/**
 * Control plane client manager
 */
export class ControlPlaneClientManager extends BasePlaneClientManager {
  /**
   * constructor
   * @param {NoslatedClient} sdk The sdk client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(public sdk: NoslatedClient, config: Config) {
    super(
      config,
      config.plane.controlPlaneCount,
      loggers.get('control plane client manager'));
  }

  /**
   * Create a control plane client.
   * @param {number} planeId The plane ID.
   * @return {ControlPlaneClient} The control plane client.
   */
  _createPlaneClient(planeId: number) {
    return new ControlPlaneClient(planeId, this.config);
  }

  /**
   *
   * @param {ControlPlaneClient} client -
   */
  _onClientReady(client: ControlPlaneClient) {
    super._onClientReady(client);
    if (this.sdk.functionProfiles == null) {
      return;
    }
    (client as any).setFunctionProfile({
      profiles: this.sdk.functionProfiles,
      mode: this.sdk.functionProfilesMode,
    }).catch((e: unknown) => {
      client.logger.warn(`Cannot set ${client.planeId}'s function profile.`, e);
    });
  }

  /**
   * @deprecated
   * There should just be one single control plane client available.
   * Sampling just doesn't make meaningful sense.
   * Remove this when we figure out an impl that hides connection details.
   * @return {ControlPlaneClient} -
   */
  sample() {
    return super.sample();
  }
}
