import { Config } from '#self/config';
import { ControlPlane } from '../control_plane';

import cp from 'child_process';
import fs from 'fs';
import path from 'path';

import { BaseOptions, BaseStarter } from './base';
import { ENV } from './constant';
import { NodejsFunctionProfile } from '#self/lib/json/function_profile';
import { WorkerStarter } from '../worker_launcher';

const NOSLATED_STARTER_PATH = require.resolve('../../starter/noslated_node');

export class NodejsStarter extends BaseStarter implements WorkerStarter {
  binPath;

  constructor(plane: ControlPlane, config: Config) {
    super('nodejs', 'node', 'node starter', plane, config);
    this.binPath = BaseStarter.findRealBinPath('nodejs', 'node');
  }

  _initValidV8Options() {
    const options = cp.execFileSync(this.binPath, ['--v8-options'], {
      encoding: 'utf8',
    });
    this._validV8Options = BaseStarter.parseV8OptionsString(options);
  }

  async _close() {
    // empty
  }

  async start(
    serverSockPath: string,
    name: string,
    credential: string,
    profile: NodejsFunctionProfile,
    bundlePath: string,
    options: BaseOptions
  ) {
    const commonExecArgv = this.getCommonExecArgv(profile, options);
    const execArgv = this.getExecArgvFromProfiler(profile);
    const commands = [
      this.bin,
      ...commonExecArgv,
      ...execArgv,
      NOSLATED_STARTER_PATH,
    ];

    const sourceDir = await fs.promises.realpath(path.join(bundlePath, 'code'));
    const envs = {
      [ENV.IPC_PATH_KEY]: serverSockPath,
      [ENV.CODE_PATH_KEY]: sourceDir,
      [ENV.WORKER_CREDENTIAL_KEY]: credential,
      [ENV.FUNC_HANDLER_KEY]: profile.handler,
    };
    if (profile.initializer) {
      envs[ENV.FUNC_INITIALIZER_KEY] = profile.initializer;
    }

    return this.doStart(name, bundlePath, commands, profile, envs, options);
  }
}
