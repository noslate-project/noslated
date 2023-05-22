import { sleep, BackoffCounter } from '#self/lib/util';
import fs from 'fs';
import path from 'path';

import { BaseOptions, BaseStarter, StarterContext, StartOptions } from './base';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import * as naming from '#self/lib/naming';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { Container, workerLogPath } from '../container/container_manager';
import { DependencyContext, Injectable } from '#self/lib/dependency_context';
import { Clock, TimerHandle } from '#self/lib/clock';

const SEED_CONTAINER_NAME = '___seed___';
const SameOriginSharedDataRoot = '/tmp/noslated-sosd';

const kValidSeedStatuses = [
  TurfContainerStates.starting,
  TurfContainerStates.init,
  TurfContainerStates.running,
  TurfContainerStates.forkwait,
];

export class AworkerStarter extends BaseStarter implements Injectable {
  static SEED_CONTAINER_NAME = SEED_CONTAINER_NAME;

  private _closed;
  private _clock: Clock;
  private _seedContainer?: Container;
  private _seedBackoffCounter = new BackoffCounter(1000, 10_000);
  private _seedBackoffTimer: TimerHandle | null = null;
  private _seedStarting = false;

  constructor(ctx: DependencyContext<StarterContext>) {
    super('aworker', 'aworker', 'aworker starter', ctx);
    this._clock = ctx.getInstance('clock');
    this._closed = false;
  }

  private async _startSeed() {
    this._seedContainer = undefined;
    const commands = [this.bin];
    if (this.config.starter.aworker.defaultSeedScript != null) {
      commands.push(
        '--mode=seed-userland',
        this.config.starter.aworker.defaultSeedScript
      );
    } else {
      commands.push('--mode=seed');
    }
    this.logger.info('starting seed with options %j', commands);

    // Create the dummy empty bundle path.
    const bundlePath = path.join(
      this.config.dirs.noslatedWork,
      'bundles',
      SEED_CONTAINER_NAME
    );
    fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });

    this._seedContainer = await this.doStart(
      SEED_CONTAINER_NAME, // container name
      bundlePath, // bundle path
      commands, // run command
      { runtime: 'aworker' }, // dummy profile: runtime
      this.config.starter.aworker.defaultEnvirons, // environment
      { additionalSpec: { turf: { seed: true } } }
    );
    this._seedContainer.onstatuschanged = this._onSeedStatusChanged;
  }

  private _onSeedStatusChanged = () => {
    if (this._seedContainer == null) {
      return;
    }
    const { _seedContainer: seedContainer } = this;
    const status = seedContainer.status;
    if (kValidSeedStatuses.includes(status)) {
      return;
    }

    this._restartSeed();
  };

  private _restartSeed = async () => {
    if (this._seedStarting) {
      return;
    }
    if (this._seedBackoffTimer) {
      this._clock.clearTimeout(this._seedBackoffTimer);
    }

    this._seedStarting = true;
    let seedStarted = false;
    try {
      if (this._seedContainer) {
        try {
          await this._seedContainer.stop();
          const state = await this._seedContainer.terminated;
          this._seedContainer = undefined;
          this.logger.info('seed terminated, last state: %j', state);
        } catch (e) {
          this.logger.error('terminate seed failed', e);
          return;
        }
      }

      try {
        await this._bootstrapSeed();
      } catch (e) {
        this.logger.info('restart seed failed', e);
        return;
      }
      seedStarted = true;
    } finally {
      this._seedStarting = false;
      if (seedStarted) {
        this._seedBackoffCounter.reset();
      } else {
        const backoffMs = this._seedBackoffCounter.next();
        this.logger.info('starting seed in %d ms', backoffMs);
        this._seedBackoffTimer = this._clock.setTimeout(
          this._restartSeed,
          backoffMs
        );
      }
    }
  };

  async _waitSeedReady() {
    let times = 100;
    do {
      if (this._closed) return;
      await sleep(50, this._clock);
      if (this._seedContainer == null) return;
      const state = await this._seedContainer.state();
      if (state.state === TurfContainerStates.forkwait) {
        return;
      }
      if (state.state >= TurfContainerStates.stopping) {
        throw new Error('Seed exited before ready');
      }
    } while (times--);

    throw new Error('Wait seed ready timeout.');
  }

  private async _bootstrapSeed() {
    await this._startSeed();
    await this._waitSeedReady();
    this.logger.info('Seed started.');
  }

  // MARK: Injectable
  async ready() {
    if (
      process.platform !== 'linux' ||
      process.env.NOSLATED_FORCE_NON_SEED_MODE
    ) {
      this.logger.info('seed is not enabled');
      return;
    }

    await this._restartSeed();
  }

  async close() {
    this._closed = true;
    if (this._seedBackoffTimer) {
      this._clock.clearTimeout(this._seedBackoffTimer);
    }
    if (this._seedContainer == null) {
      return;
    }

    try {
      await this._seedContainer.stop();
    } catch (e) {
      this.logger.error('failed to stop seed', e);
    }
  }

  // MARK: WorkerStarter
  async start(
    serverSockPath: string,
    name: string,
    credential: string,
    profile: AworkerFunctionProfile,
    bundlePath: string,
    options: BaseOptions
  ) {
    this.logger.debug('start worker(%s)', name);
    const sourceFile = path.join(bundlePath, 'code', profile.sourceFile);
    const sameOriginSharedDataDir = path.join(
      SameOriginSharedDataRoot,
      naming.normalizeFuncNameToName(profile.name)
    );

    let useSeed = true;
    if (
      this._seedContainer?.status !== TurfContainerStates.forkwait ||
      profile.worker?.disableSeed
    ) {
      useSeed = false;
    }

    const startOptions: StartOptions = {
      inspect: !!options?.inspect,
      mkdirs: [sameOriginSharedDataDir],
    };

    const runLogDir = this.config.logger.dir;
    const logDirectory = workerLogPath(runLogDir, name);

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

    this.logger.info(
      'Up to start %s (func: %s) with %s mode.',
      name,
      profile.name,
      useSeed ? 'seed' : 'non-seed'
    );
    return this.doStart(
      name,
      bundlePath,
      commands,
      profile,
      this.config.starter.aworker.defaultEnvirons,
      startOptions
    );
  }
}
