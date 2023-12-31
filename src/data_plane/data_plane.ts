import fs from 'fs';
import path from 'path';
import { Config, config, dumpConfig } from '#self/config';
import { Base } from '#self/lib/sdk_base';
import { DataFlowController } from './data_flow_controller';
import { DataPlaneHost } from './data_plane_host';
import { getCurrentPlaneId } from '#self/lib/util';
import { Logger, loggers } from '#self/lib/loggers';
import { DaprAdaptor } from '#self/delegate/dapr_adaptor';
import { clearAllLoggers } from '@midwayjs/logger';

export interface ConfigurableDataPlaneDeps {
  config?: Config;
}

export class DataPlane extends Base {
  config: Config;
  logger: Logger;
  host: DataPlaneHost;
  dataFlowController: DataFlowController;

  constructor(deps?: ConfigurableDataPlaneDeps) {
    super();
    this.config = deps?.config ?? config;
    dumpConfig('data', this.config);

    this.logger = loggers.get('data plane');
    const sockPath = path.join(
      config.dirs.noslatedSock,
      `dp-${getCurrentPlaneId()}.sock`
    );
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });

    this.host = new DataPlaneHost(`unix://${sockPath}`, this.config);
    this.dataFlowController = new DataFlowController(this.host, this.config);
  }

  _close() {
    return Promise.all([
      this.dataFlowController.close(),
      this.host.close(),
      clearAllLoggers(),
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
    const modOptions = this.config.dataPlane.daprAdaptorModuleOptions;

    this.logger.info('load dapr module', modPath);

    if (!modPath) {
      return;
    }

    const Clz = require(modPath);

    const options = Object.assign(
      {
        logger: loggers.get('dapr'),
      },
      modOptions || {}
    );

    const mod = new Clz(options);

    await mod.ready();
    this.dataFlowController.delegate.setDaprAdaptor(mod);
  }
}
