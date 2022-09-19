import { BaseOf } from './sdk_base';
import { Guest } from './rpc/guest';
import { PrefixedLogger } from './loggers';
import { Config } from '#self/config';

/**
 * Base plane client
 */
export class BasePlaneClient extends BaseOf(Guest) {
  logger: PrefixedLogger;
  planeId: number;
  config: Config;
  role: string;

  /**
   * constructor
   * @param {string} role The plane client role name.
   * @param {string} sockPath The socket path.
   * @param {number} planeId The plane client ID.
   * @param {Config} config The global config object.
   */
  constructor(role: string, sockPath: string, planeId: number, config: Config) {
    super(`unix://${sockPath}`);
    this.on('error', (e: Error) => {
      this.logger.error(`Error occurred in ${role} client ${planeId}.`, e);
    });

    this.role = role;
    this.logger = new PrefixedLogger(role, String(planeId));
    this.planeId = planeId;
    this.config = config;
  }

  /**
   * Init
   * @return {Promise<void>} void
   */
  async _init() {
    this.logger.info('%s(%s) connecting...', this.role, this.planeId);
    await this.start({
      connectionTimeout: this.config.plane.planeFirstConnectionTimeout,
    });
    this.logger.info('%s(%s) connected.', this.role, this.planeId);
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
