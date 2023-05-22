import fs from 'fs';
import path from 'path';

import { BaseOptions, BaseStarter } from './base';
import { ENV } from './constant';
import { NodejsFunctionProfile } from '#self/lib/json/function_profile';
import { ControlPlaneDependencyContext } from '../deps';
import { Injectable } from '#self/lib/dependency_context';

const NOSLATED_STARTER_PATH = require.resolve('../../starter/noslated_node');

export class NodejsStarter extends BaseStarter implements Injectable {
  constructor(ctx: ControlPlaneDependencyContext) {
    super('nodejs', 'node', 'node starter', ctx);
  }

  // MARK: Injectable
  async ready() {
    /** empty */
  }
  async close() {
    /** empty */
  }

  // MARK: WorkerStarter
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
