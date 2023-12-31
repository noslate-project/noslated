import { BasePlaneClientManager } from '#self/lib/base_plane_client_manager';
import { DataPlaneClient } from './data_plane_client';
import loggers from '#self/lib/logger';
import { NoslatedClient } from './client';
import { Config } from '#self/config';
import { LoggerFactory } from '#self/lib/logger_factory';

export class DataPlaneClientManager extends BasePlaneClientManager {
  /**
   * constructor
   * @param {NoslatedClient} sdk The sdk client.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(public sdk: NoslatedClient, config: Config) {
    super(
      config,
      config.plane.dataPlaneCount,
      LoggerFactory.prefix('data plane client manager')
    );
  }

  /**
   * Create a data plane client.
   * @param {number} planeId The plane ID.
   * @return {DataPlaneClient} The created data plane client.
   */
  _createPlaneClient(planeId: number) {
    return new DataPlaneClient(planeId, this.config);
  }

  /**
   *
   * @param {DataPlaneClient} client -
   */
  async _onClientReady(client: DataPlaneClient) {
    super._onClientReady(client);
    const promises = [];
    if (this.sdk.serviceProfiles != null) {
      promises.push(
        (client as any).setServiceProfiles({
          profiles: this.sdk.serviceProfiles,
        })
      );
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
