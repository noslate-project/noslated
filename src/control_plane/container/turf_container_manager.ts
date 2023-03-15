import path from 'path';
import fs from 'fs';
import { Config } from '#self/config';
import { Logger, loggers } from '#self/lib/loggers';
import { createDeferred, Deferred, sleep } from '#self/lib/util';
import {
  Container,
  ContainerManager,
  ContainerStartOptions,
  workerLogPath,
} from './container_manager';
import { Turf } from '#self/lib/turf';
import {
  TurfCode,
  TurfContainerStates,
  TurfProcess,
  TurfSpec,
  TurfStartOptions,
  TurfState,
} from '#self/lib/turf/types';
import { DependencyContext } from '#self/lib/dependency_context';
import { ConfigContext } from '../deps';
import { TaskQueue } from '#self/lib/task_queue';

const TurfStopRetryableCodes = [TurfCode.EAGAIN];

export class TurfContainerManager implements ContainerManager {
  private config: Config;
  private bundlePathLock = new Map<string, Promise<void>>();
  private logger: Logger;
  private containers = new Map<string, TurfContainer>();
  cleanupQueue: TaskQueue<TurfContainer>;

  client: Turf;

  constructor(ctx: DependencyContext<ConfigContext>) {
    this.config = ctx.getInstance('config');
    this.client = new Turf(this.config.turf.bin, this.config.turf.socketPath);
    this.logger = loggers.get('turf-manager');

    this.cleanupQueue = new TaskQueue(this._cleanup, {
      concurrency: 1,
    });
  }

  async ready() {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async spawn(
    name: string,
    bundlePath: string,
    spec: TurfSpec,
    options?: ContainerStartOptions
  ): Promise<Container> {
    const runLogDir = this.config.logger.dir;
    const logPath = workerLogPath(runLogDir, name);
    const specPath = path.join(bundlePath, 'config.json');

    await this._bundlePathLock(bundlePath, async () => {
      await fs.promises.writeFile(specPath, JSON.stringify(spec), 'utf8');
      this.logger.info('turf create (%s, %s)', name, bundlePath);
      await this.client.create(name, bundlePath);
    });

    const startOptions: TurfStartOptions = {
      stdout: path.join(logPath, 'stdout.log'),
      stderr: path.join(logPath, 'stderr.log'),
    };
    if (options?.seed) startOptions.seed = options.seed;

    this.logger.info('turf start (%s)', name);
    // TODO: retrieve pid immediately.
    try {
      await this.client.start(name, startOptions);
    } catch (e) {
      await this.client.delete(name).catch(e => {
        this.logger.error(
          'failed to delete container %s when it failed to start',
          name,
          e
        );
      });
      throw e;
    }

    const container = new TurfContainer(this, name);
    this.containers.set(name, container);
    return container;
  }

  getContainer(name: string): Container | null {
    return this.containers.get(name) ?? null;
  }

  list() {
    return Array.from(this.containers.values());
  }

  async reconcileContainers() {
    const psData = await this.client.ps();
    const psMap = new Map<string, TurfProcess>();
    for (const item of psData) {
      psMap.set(item.name, item);
    }

    const unknownNames = [];
    for (const item of this.containers.values()) {
      const pi = psMap.get(item.name);
      if (pi == null) {
        item.updateStatus(TurfContainerStates.unknown);
        unknownNames.push(item.name);
        continue;
      }
      item.pid = pi.pid;
      item.updateStatus(pi.status);
    }
    for (const name of unknownNames) {
      this.containers.delete(name);
    }
  }

  private async _bundlePathLock<T>(bundlePath: string, fn: () => T) {
    const start = Date.now();
    let bundlePathLock = this.bundlePathLock.get(bundlePath);
    while (bundlePathLock != null) {
      await bundlePathLock;
      bundlePathLock = this.bundlePathLock.get(bundlePath);
    }

    this.logger.info(
      'fetched lock on bundle path(%s) cost %d ms',
      bundlePath,
      Date.now() - start
    );
    const { promise, resolve } = createDeferred<void>();
    this.bundlePathLock.set(bundlePath, promise);
    try {
      return await fn();
    } finally {
      this.bundlePathLock.delete(bundlePath);
      resolve();
    }
  }

  private _cleanup = (container: TurfContainer) => {
    return container._onStopped();
  };
}

export class TurfContainer implements Container {
  private client: Turf;
  private logger: Logger;
  pid?: number;
  status: TurfContainerStates;
  onstatuschanged = () => {};
  terminated: Promise<TurfState | null>;
  terminatedDeferred: Deferred<TurfState | null>;

  constructor(private manager: TurfContainerManager, public name: string) {
    this.client = manager.client;
    this.logger = manager['logger'];
    this.status = TurfContainerStates.init;
    this.terminatedDeferred = createDeferred();
    this.terminated = this.terminatedDeferred.promise;
  }

  async stop() {
    try {
      await this.client.stop(this.name, false);
    } catch (e: any) {
      if (!TurfStopRetryableCodes.includes(e.code)) {
        this.logger.info('%s stop failed', this.name, e.message);
        throw e;
      }
      this.logger.info('%s stop failed, force stopping after 3s', this.name);
      await sleep(this.manager['config'].turf.gracefulExitPeriodMs);
      await this.client.stop(this.name, true);
    }
  }

  async state(): Promise<TurfState> {
    const state = await this.client.state(this.name);
    this.stateUpdate(state);
    return state;
  }

  updateStatus(newStatus: TurfContainerStates) {
    if (this.status === newStatus) {
      return;
    }
    this.status = newStatus;
    if (newStatus >= TurfContainerStates.stopped) {
      this.manager.cleanupQueue.enqueue(this);
    }
    try {
      this.onstatuschanged();
    } catch (err) {
      this.logger.error(
        'unexpected error on onstatuschanged %s',
        this.name,
        err
      );
    }
  }

  async _onStopped() {
    let state: TurfState | null = null;
    try {
      state = await this.client.state(this.name);
    } catch (err) {
      this.logger.error('unexpected error on state %s', this.name, err);
    }

    try {
      await this.client.delete(this.name);
    } catch (err) {
      this.logger.error('unexpected error on delete %s', this.name, err);
    }

    this.manager['containers'].delete(this.name);
    this.terminatedDeferred.resolve(state);
  }

  private stateUpdate(report: TurfState) {
    this.pid = report.pid;
    this.updateStatus(report.state);
  }
}
