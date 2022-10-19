import fs from 'fs';
import path from 'path';
import { Config, dumpConfig } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { DataFlowController } from './data_flow_controller';
import { DataPlaneHost } from './data_plane_host';
import { getCurrentPlaneId } from '#self/lib/util';
import { Logger } from '#self/lib/loggers';

const loggers = require('#self/lib/logger');

export class DataPlane extends Base {
  logger: Logger;
  host: DataPlaneHost;
  dataFlowController: DataFlowController;

  constructor(private config: Config) {
    super();
    dumpConfig('sdk', config);

    this.logger = loggers.get('data plane');
    const sockPath = path.join(config.dirs.noslatedSock, `dp-${getCurrentPlaneId()}.sock`);
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });

    this.host = new DataPlaneHost(`unix://${sockPath}`, this.config);
    this.dataFlowController = new DataFlowController(this.host, this.config);
  }

  _close() {
    return Promise.all([
      this.dataFlowController.close(),
      this.host.close(),
    ]);
  }

  async _init() {
    await this.host.start(this.dataFlowController);
    await this.dataFlowController.ready();
    this.logger.info(`listened at ${this.host.address}.`);
  }
}
