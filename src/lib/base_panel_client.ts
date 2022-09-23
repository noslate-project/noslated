import { BaseOf } from './sdk_base';
import { Guest } from './rpc/guest';
import { PrefixedLogger } from './loggers';
import { Config } from '#self/config';

/**
 * Base panel client
 */
export class BasePanelClient extends BaseOf(Guest) {
  logger: PrefixedLogger;
  panelId: number;
  config: Config;
  role: string;

  /**
   * constructor
   * @param {string} role The panel client role name.
   * @param {string} sockPath The socket path.
   * @param {number} panelId The panel client ID.
   * @param {Config} config The global config object.
   */
  constructor(role: string, sockPath: string, panelId: number, config: Config) {
    super(`unix://${sockPath}`);
    this.on('error', (e: Error) => {
      this.logger.error(`Error occurred in ${role} client ${panelId}.`, e);
    });

    this.role = role;
    this.logger = new PrefixedLogger(role, String(panelId));
    this.panelId = panelId;
    this.config = config;
  }

  /**
   * Init
   * @return {Promise<void>} void
   */
  async _init() {
    this.logger.info('%s(%s) connecting...', this.role, this.panelId);
    await this.start({
      connectionTimeout: this.config.panel.panelFirstConnectionTimeout,
    });
    this.logger.info('%s(%s) connected.', this.role, this.panelId);
  }

  /**
   * Close
   * @return {Promise<void>} void
   */
  async _close() {
    try {
      Guest.prototype.close.call(this);
    } catch (e) {
      this.logger.warn(e);
    }
  }
}
