import path from 'path';
import fs from 'fs';
import { Config } from '#self/config';
import { Logger, loggers } from '#self/lib/loggers';
import { createDeferred, Deferred, sleep } from '#self/lib/util';
import {
  Container,
  ContainerCreateOptions,
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

const TurfStopRetryableCodes = [TurfCode.EAGAIN];

export class TurfContainerManager implements ContainerManager {
  private config: Config;
  private bundlePathLock = new Map<string, Promise<void>>();
  private logger: Logger;
  private containers = new Map<string, TurfContainer>();

  client: Turf;

  constructor(ctx: DependencyContext<ConfigContext>) {
    this.config = ctx.getInstance('config');
    this.client = new Turf(this.config.turf.bin, this.config.turf.socketPath);
    this.logger = loggers.get('turf-manager');
  }

  async ready() {
    await this.client.connect();
  }

  async close(): Promise<void> {
    await this.client.close();
  }

  async create(
    name: string,
    bundlePath: string,
    spec: TurfSpec,
    options?: ContainerCreateOptions
  ): Promise<Container> {
    const runLogDir = this.config.logger.dir;
    const logPath = workerLogPath(runLogDir, name);
    const specPath = path.join(bundlePath, 'config.json');

    this.logger.info('create directories for worker(%s)', name);
    await Promise.all(
      [logPath, ...(options?.mkdirs ?? [])].map(dir =>
        fs.promises.mkdir(dir, { recursive: true })
      )
    );

    await this._bundlePathLock(bundlePath, async () => {
      await fs.promises.writeFile(specPath, JSON.stringify(spec), 'utf8');
      this.logger.info('turf create (%s, %s)', name, bundlePath);
      await this.client.create(name, bundlePath);
    });

    const container = new TurfContainer(
      this.client,
      logPath,
      this.logger,
      name
    );
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

    const newMemo = new Map<string, TurfContainer>();
    for (const item of this.containers.values()) {
      const pi = psMap.get(item.name);
      if (pi == null) {
        item.updateStatus(TurfContainerStates.unknown);
        continue;
      }
      item.pid = pi.pid;
      item.updateStatus(pi.status);
      newMemo.set(item.name, item);
    }
    this.containers = newMemo;
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
}

export class TurfContainer implements Container {
  pid?: number;
  status: TurfContainerStates;
  onstatuschanged?: () => void;
  terminated: Promise<void>;
  terminatedDeferred: Deferred<void>;

  constructor(
    private client: Turf,
    private logPath: string,
    private logger: Logger,
    public name: string
  ) {
    this.status = TurfContainerStates.init;
    this.terminatedDeferred = createDeferred<void>();
    this.terminated = this.terminatedDeferred.promise;
  }

  async start(options?: ContainerStartOptions) {
    const startOptions: TurfStartOptions = {
      stdout: path.join(this.logPath, 'stdout.log'),
      stderr: path.join(this.logPath, 'stderr.log'),
    };
    if (options?.seed) startOptions.seed = options.seed;
    this.logger.info('turf start (%s)', this.name);
    // TODO: retrieve pid immediately.
    await this.client.start(this.name, startOptions);
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
      await sleep(3000);
      await this.client.stop(this.name, true);
    }
  }

  async delete() {
    await this.client.delete(this.name);
  }

  async destroy() {
    await this.stop();
    await this.delete();
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
    if (this.status === TurfContainerStates.stopped) {
      this.terminatedDeferred.resolve();
    }
    this.onstatuschanged?.();
  }

  private stateUpdate(report: TurfState) {
    this.pid = report.pid;
    this.updateStatus(report.state);
  }
}
