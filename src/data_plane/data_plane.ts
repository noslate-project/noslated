import fs from 'fs';
import path from 'path';
import { Config, dumpConfig } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { DataFlowController } from './data_flow_controller';
import { DataPlaneHost } from './data_plane_host';
import { getCurrentPlaneId } from '#self/lib/util';
import { Logger, loggers } from '#self/lib/loggers';
import { DaprAdaptor } from '#self/delegate/dapr_adaptor';

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
    await this._loadDaprAdaptor();
    await this.host.start(this.dataFlowController);
    await this.dataFlowController.ready();
    this.logger.info(`listened at ${this.host.address}.`);
  }

  public setDaprAdaptor(it: DaprAdaptor) {
    this.dataFlowController.delegate.setDaprAdaptor(it);
  }

  private async _loadDaprAdaptor() {
    const modPath = this.config.dataPlane.daprAdaptorModulePath;
    this.logger.info('load dapr module', modPath);
    if (modPath == null) {
      return;
    }
    const Clz = require(modPath);

    const mod = new Clz({
      logger: loggers.get('dapr'),
    });

    await mod.ready();
    this.dataFlowController.delegate.setDaprAdaptor(mod);
  }
}
