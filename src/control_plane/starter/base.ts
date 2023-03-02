import fs from 'fs';
import os from 'os';
import path from 'path';
import extend from 'extend';

import { Base } from '#self/lib/sdk_base';
import loggers from '#self/lib/logger';
import { pairsToMap } from '#self/lib/rpc/key_value_pair';
import { ErrorCode } from '../worker_launcher_error_code';
import {
  ProcessFunctionProfile,
  RawFunctionProfile,
} from '#self/lib/json/function_profile';
import SPEC_TEMPLATE from '../../lib/json/spec.template.json';
import { kCpuPeriod, kMegaBytes } from '../constants';
import { Container, ContainerManager } from '../container/container_manager';
import { PlatformEnvironsUpdatedEvent } from '../events';
import { Config } from '#self/config';
import { EventBus } from '#self/lib/event-bus';
import { DependencyContext } from '#self/lib/dependency_context';
import { ResourceManager, ResourceManagerContext } from '../resource_manager';

export interface BaseOptions {
  inspect?: boolean;
}

export interface StartOptions extends BaseOptions {
  additionalSpec?: any;
  seed?: string;
  mkdirs?: string[];
}

export type StarterContext = {
  config: Config;
  containerManager: ContainerManager;
  resourceManager: ResourceManager;
  eventBus: EventBus;
} & ResourceManagerContext;

export abstract class BaseStarter extends Base {
  /**
   * Find the real bin path
   * @param {string} runtimeName The runtime name.
   * @param {string} binName the binary name.
   * @return {string} The real bin path.
   */
  static findRealBinPath(runtimeName: string, binName: string) {
    const turfWorkDir =
      process.env.TURF_WORKDIR || path.join(os.homedir(), '.turf');
    const runtimeDir = path.join(turfWorkDir, 'runtime', runtimeName);

    let ret = path.join(runtimeDir, 'bin', binName);
    if (fs.existsSync(ret)) return ret;

    ret = path.join(runtimeDir, 'usr', 'bin', binName);
    if (fs.existsSync(ret)) return ret;

    ret = path.join(runtimeDir, binName);
    if (fs.existsSync(ret)) return ret;

    throw new Error(`No executable ${binName} in turf runtime ${runtimeName}.`);
  }

  /**
   * Parse --v8-options string to array
   * @param {string} str The --v8-options string.
   * @return {string[]} The parsed --v8-options.
   */
  static parseV8OptionsString(str: string) {
    const lines = str
      .replace(/^([\w\W]+Options:)/, '')
      .trim()
      .split('\n')
      .map(line => line.trim());

    const ret = [];
    let name: string;
    for (let i = 0; i < lines.length; i++) {
      if (i % 2 === 0) {
        name = lines[i].replace(/(\s+(\(.+\))?)$/, '');
      } else {
        ret.push(name!);

        const meta = /^type: (.+?)(\s+.*)?$/.exec(lines[i]);
        if (meta?.[1] === 'bool') {
          ret.push(name!.replace('--', '--no-'));
        }
      }
    }

    return ret;
  }

  runtime;
  bin;
  logger;
  config;
  containerManager;
  resourceManager;
  _validV8Options: string[];

  platformEnvirons: Record<string, string> = {};

  constructor(
    runtime: string,
    bin: string,
    loggerName: string,
    ctx: DependencyContext<StarterContext>
  ) {
    super();
    this.runtime = runtime;
    this.bin = bin;
    this.logger = loggers.get(loggerName);
    this._validV8Options = [];
    this.config = ctx.getInstance('config');
    this.containerManager = ctx.getInstance('containerManager');
    this.resourceManager = ctx.getInstance('resourceManager');

    const eventBus = ctx.getInstance('eventBus');
    eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
      next: event => {
        this.platformEnvirons = event.data;
      },
    });
  }

  /**
   * @type {string[]}
   */
  get validV8Options() {
    return this._validV8Options;
  }

  /**
   * Init valid v8 options (override)
   */
  abstract _initValidV8Options(): void;

  /**
   * Init (override)
   */
  async _init() {
    this._initValidV8Options();
  }

  /**
   * Close (override)
   */
  abstract _close(): Promise<void>;

  /**
   * Get common exec argv
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile} profile The function profile.
   * @param {{ inspect?: boolean }} options The options.
   * @return {string[]} The common exec argv.
   */
  getCommonExecArgv(profile: RawFunctionProfile, options: BaseOptions = {}) {
    const ret = [];

    if (profile.resourceLimit?.memory !== undefined) {
      // 为堆外预留 20% 的空间
      ret.push(
        `--max-heap-size=${Math.floor(
          (profile.resourceLimit.memory / kMegaBytes) * 0.8
        )}`
      );
    }

    if (options.inspect) {
      ret.push(
        this.runtime === 'nodejs' ? '--inspect=127.0.0.1:0' : '--inspect'
      );
    }

    return ret;
  }

  /**
   * Check v8 options
   * @param {string[]} options The v8 options.
   */
  checkV8Options(options: string[]) {
    for (let opt of options) {
      opt = opt.replace(/(=.*)?$/, '');
      if (!this.validV8Options.includes(opt)) {
        const err = new Error(
          `Additional v8Options array includes an invalid v8 option ${opt}.`
        );
        err.code = ErrorCode.kInvalidV8Option;
        throw err;
      }
    }
  }

  /**
   * Get exec argv
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile} profile The function profile.
   * return {string[]} The additional exec argv.
   */
  getExecArgvFromProfiler(profile: RawFunctionProfile) {
    return ([] as string[]).concat(
      profile?.worker?.v8Options ?? [],
      profile?.worker?.execArgv ?? []
    );
  }

  /**
   * do turf start
   * @param name the container name
   * @param bundlePath the bundle path (which has `code` under it)
   * @param args the run command
   * @param profile the profile to be started
   * @param appendEnvs the environment variables to be appended
   * @param options the start options
   */
  async doStart(
    name: string,
    bundlePath: string,
    args: string[],
    profile: ProcessFunctionProfile,
    appendEnvs: Record<string, string> = {},
    options: StartOptions = {}
  ): Promise<Container> {
    const codePath = path.join(bundlePath, 'code');

    const envs = Object.assign(
      {
        TZ: process.env.TZ,
      },
      this.platformEnvirons,
      pairsToMap(profile.environments || []),
      appendEnvs
    );

    envs.NOSLATE_WORKER_ID = name;
    envs.HOME = codePath;

    delete envs.PATH;
    delete envs.TERM;

    const spec = extend(true, {}, SPEC_TEMPLATE, options?.additionalSpec || {});

    spec.process.args = args;
    spec.process.env = spec.process.env.concat(
      Object.keys(envs).map(key => `${key}=${envs[key]}`)
    );
    spec.turf.runtime = profile.runtime;

    if (profile.resourceLimit?.memory !== undefined) {
      spec.linux.resources.memory.limit = profile.resourceLimit.memory;
    }
    if (
      profile.resourceLimit?.cpu !== undefined &&
      profile.resourceLimit.cpu > 0 &&
      profile.resourceLimit.cpu <= 1
    ) {
      // "cpu": {
      //   "shares": 1024,
      //   "quota": 1000000,
      //   "period": 1000000
      // }
      // Expected cpu time share with turf (ms/1s): quota / period / 1000.
      spec.linux.resources.cpu = {
        shares: 1024,
        quota: profile.resourceLimit.cpu * kCpuPeriod,
        period: kCpuPeriod,
      };
    }

    // inspect 模式下最大可用扩大 100 倍
    // 但在扩缩容统计中只占原始内存池
    if (options?.inspect) {
      spec.linux.resources.memory.limit *= 100;
    }

    const [container] = await Promise.all([
      this.containerManager.create(name, bundlePath, spec),
      this.resourceManager.makeWorkerDirs(name, options.mkdirs ?? []),
    ]);
    await container.start(options);
    return container;
  }

  /**
   * Start a worker process.
   * @param {string} serverSockPath The server socket path.
   * @param {string} name The worker name.
   * @param {string} credential The worker credential.
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile} profile The function profile object.
   * @param {string} bundlePath The bundle path.
   * @param {{ inspect?: boolean }} options The options.
   */
  abstract start(
    serverSockPath: string,
    name: string,
    credential: string,
    profile: RawFunctionProfile,
    bundlePath: string,
    options: BaseOptions
  ): Promise<Container>;
}
