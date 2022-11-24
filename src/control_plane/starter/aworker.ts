import { castError, sleep } from '#self/lib/util';
import cp from 'child_process';
import fs from 'fs';
import path from 'path';

import { BaseOptions, BaseStarter, StartOptions } from './base';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import * as naming from '#self/lib/naming';
import { ControlPlane } from '../control_plane';
import { Config } from '#self/config';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { TurfState } from '#self/lib/turf/types';

const SEED_CONTAINER_NAME = '___seed___';
const SameOriginSharedDataRoot = '/tmp/noslated-sosd';

export class AworkerStarter extends BaseStarter {
  static SEED_CONTAINER_NAME = SEED_CONTAINER_NAME;
  keepSeedAliveTimer: ReturnType<typeof setTimeout> | null;
  closed;
  binPath;
  lastSeedState?: TurfContainerStates;

  constructor(plane: ControlPlane, config: Config) {
    super('aworker', 'aworker', 'aworker starter', plane, config);
    this.keepSeedAliveTimer = null;
    this.closed = false;
    this.binPath = BaseStarter.findRealBinPath('aworker', 'aworker');
  }

  _initValidV8Options() {
    const options = cp.execFileSync(this.binPath, [ '--v8-options' ], {
      encoding: 'utf8',
    });
    this._validV8Options = BaseStarter.parseV8OptionsString(options);
  }

  async seedStatus() {
    if (this.lastSeedState === TurfContainerStates.forkwait) {
      return this.lastSeedState;
    }
    let state: TurfState | null;
    try {
      state = await this.turf.state(SEED_CONTAINER_NAME);
    } catch (exp) {
      this.logger.warn(`Cannot state ${SEED_CONTAINER_NAME}.`, exp);
      return null;
    }
    this.lastSeedState = state?.state;
    return this.lastSeedState;
  }

  async startSeed() {
    this.lastSeedState = undefined;
    const commands = [ this.bin ];
    if (this.config.starter.aworker.defaultSeedScript != null) {
      commands.push('--mode=seed-userland', this.config.starter.aworker.defaultSeedScript);
    } else {
      commands.push('--mode=seed');
    }
    this.logger.info('starting seed with options %j', commands);

    // Create the dummy empty bundle path.
    const bundlePath = path.join(this.config.dirs.noslatedWork, 'bundles', SEED_CONTAINER_NAME);
    fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });

    await this.doStart(
      SEED_CONTAINER_NAME, // container name
      bundlePath, // bundle path
      commands, // run command
      { runtime: 'aworker' }, // dummy profile: runtime
      this.config.starter.aworker.defaultEnvirons, // environment
      { additionalSpec: { turf: { seed: true } } }); // additional spec

    await this.seedStatus();
  }

  async waitSeedReady() {
    let times = 100;
    do {
      if (this.closed) return;
      await sleep(50);
      const state = await this.seedStatus();
      if (state === TurfContainerStates.forkwait) {
        return;
      }
    } while (times--);

    throw new Error('Wait seed ready timeout.');
  }

  async keepSeedAlive() {
    this.keepSeedAliveTimer = null;
    try {
      const status = await this.turf.state(SEED_CONTAINER_NAME)
        .catch((exp: unknown) => {
          const e = castError(exp);
          if (!e.message.includes('not found')) {
            this.logger.warn(`Cannot state ${SEED_CONTAINER_NAME}.`, e);
          }
          return null;
        });
      if (this.closed) return;
      let needStart = false;
      if (status == null) {
        needStart = true;
      } else if (![
        TurfContainerStates.starting,
        TurfContainerStates.init,
        TurfContainerStates.running,
        TurfContainerStates.forkwait,
      ].includes(status.state)) {
        needStart = true;
        await this.turf.destroy(SEED_CONTAINER_NAME);
        if (this.closed) return;
      }

      if (needStart && !this.closed) {
        this.logger.info('starting seed... oldStatus:', status);
        await this.startSeed();
        if (this.closed) return;
        this.waitSeedReady().then(() => {
          this.logger.info('Seed process started.');
        }).catch(e => {
          this.logger.warn(e);
        });
      }
    } catch (e) {
      this.logger.warn('Failed to keep seed alive.', e);
    } finally {
      if (!this.closed) {
        this.keepSeedAliveTimer = setTimeout(this.keepSeedAlive.bind(this), 1000);
      }
    }
  }

  async _init() {
    await super._init();
    if (process.platform !== 'darwin' && !process.env.NOSLATED_FORCE_NON_SEED_MODE) {
      await this.keepSeedAlive();
    }
  }

  async _close() {
    this.closed = true;
    if (this.keepSeedAliveTimer) {
      clearTimeout(this.keepSeedAliveTimer);
      this.keepSeedAliveTimer = null;
    }

    try {
      await this.turf.destroy(SEED_CONTAINER_NAME);
    } catch (e) {
      this.logger.warn(e);
    }
  }

  async start(serverSockPath: string, name: string, credential: string, profile: AworkerFunctionProfile, bundlePath: string, options: BaseOptions) {
    this.logger.info('start worker(%s)', name);
    const sourceFile = path.join(bundlePath, 'code', profile.sourceFile);
    const sameOriginSharedDataDir = path.join(SameOriginSharedDataRoot, naming.normalizeFuncNameToName(profile.name));

    let useSeed = true;
    const seedStatus = await this.seedStatus();
    if (seedStatus !== TurfContainerStates.forkwait) {
      useSeed = false;
    }

    const startOptions: StartOptions = {
      inspect: !!options?.inspect,
      mkdirs: [sameOriginSharedDataDir],
    };

    const runLogDir = this.config.logger.dir;
    const logDirectory = BaseStarter.logPath(runLogDir, name);

    // TODO(kaidi.zkd): different commands between seed and non-seed mode
    const commonExecArgv = this.getCommonExecArgv(profile, options);
    const execArgv = this.getExecArgvFromProfiler(profile);
    const commands = [
      this.bin,
      ...commonExecArgv,
      ...execArgv,
      '-A',
      `--agent-ipc=${serverSockPath}`,
      `--agent-cred=${credential}`,
      `--same-origin-shared-data-dir=${sameOriginSharedDataDir}`,
      `--trace-event-directory=${logDirectory}`,
      `--report-directory=${logDirectory}`,
      sourceFile,
    ];

    // Do not use seed to fork new process in inspect mode.
    // CpuProfiler is not compatible with fork.
    if (useSeed && !startOptions.inspect) {
      startOptions.seed = SEED_CONTAINER_NAME;
    }

    this.logger.info(`Up to start ${name} (func: ${profile.name}) with ${useSeed ? '' : 'non-'}seed mode.`);
    await this.doStart(name, bundlePath, commands, profile, this.config.starter.aworker.defaultEnvirons, startOptions);
  }
}
