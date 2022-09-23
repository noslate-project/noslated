import fs from 'fs';
import path from 'path';
import { Config, dumpConfig } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { DataFlowController } from './data_flow_controller';
import { DataPanelHost } from './data_panel_host';
import { getCurrentPanelId } from '#self/lib/util';
import { Logger } from '#self/lib/loggers';

const loggers = require('#self/lib/logger');

export class DataPanel extends Base {
  logger: Logger;
  host: DataPanelHost;
  dataFlowController: DataFlowController;

  constructor(private config: Config) {
    super();
    dumpConfig('sdk', config);

    this.logger = loggers.get('data panel');
    const sockPath = path.join(config.dirs.aliceSock, `dp-${getCurrentPanelId()}.sock`);
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });

    this.host = new DataPanelHost(`unix://${sockPath}`, this.config);
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
