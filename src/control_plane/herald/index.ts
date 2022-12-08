import fs from 'fs';
import path from 'path';
import { descriptor } from '#self/lib/rpc/util';
import { HeraldImpl } from './impl';
import { Host } from '#self/lib/rpc/host';
import { getCurrentPlaneId } from '#self/lib/util';
import { ControlPlane } from '../control_plane';
import { Config } from '#self/config';

const logger = require('#self/lib/logger').get('herald');

/**
 * Herald：传令者服务器
 * 用于 Control Plane 与其它进程之间进行指令传输的角色
 */
export class Herald extends Host {
  impl: HeraldImpl;

  constructor(public plane: ControlPlane, public config: Config) {
    const sockPath = path.join(config.dirs.noslatedSock, `cp-${getCurrentPlaneId()}.sock`);
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });

    super(`unix://${sockPath}`, logger);
    this.impl = new HeraldImpl(config, this);
  }

  async ready() {
    this.addService((descriptor as any).noslated.control.ControlPlane.service, this.impl as any);
    await super.start();
    logger.info(`listened at ${this.address}.`);
  }

  async close() {
    await super.close();
    fs.rmSync(this.address, { force: true });
    logger.debug('closed.');
  }
}
