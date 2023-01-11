import { Base } from '#self/lib/sdk_base';
import { castError } from '#self/lib/util';
import loggers from '#self/lib/logger';
import * as naming from '#self/lib/naming';
import * as starters from './starter';
import { ErrorCode } from './worker_launcher_error_code';
import { ControlPlane } from './control_plane';
import { Config } from '#self/config';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { BaseOptions } from './starter/base';
import { CodeManager } from './code_manager';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { DataPlaneClientManager } from './data_plane_client/manager';
import { WorkerStatsSnapshot } from './worker_stats';
import { kMemoryLimit } from './constants';
import { performance } from 'perf_hooks';
import { ControlPanelEvent } from '#self/lib/constants';
import { Priority, TaskQueue } from '#self/lib/task_queue';

export interface WorkerStarter {
  start(
    serverSockPath: string,
    name: string,
    credential: string,
    profile: RawFunctionProfile,
    bundlePath: string,
    options: BaseOptions
  ): Promise<void>;
}

export class WorkerLauncher extends Base {
  plane;
  turf;
  logger;
  config;
  starters;
  codeManager!: CodeManager;
  functionProfile!: FunctionProfileManager;
  dataPlaneClientManager!: DataPlaneClientManager;
  snapshot!: WorkerStatsSnapshot;
  launchQueue: TaskQueue<LaunchTask>;

  /**
   * Constructor
   * @param {import('./control_plane').ControlPlane} plane The plane object.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(plane: ControlPlane, config: Config) {
    super();
    this.plane = plane;
    this.turf = plane.turf;

    this.logger = loggers.get('worker launcher');
    this.config = config;

    this.starters = {
      nodejs: new starters.Nodejs(plane, config),
      aworker: new starters.Aworker(plane, config),
    };

    this.launchQueue = new TaskQueue(this.doTryLaunch, {
      concurrency: config.controlPlane.expandConcurrency,
      clock: plane.clock,
    });
  }

  /**
   * Close (override)
   */
  async _close() {
    await Promise.all([
      this.starters.nodejs.close(),
      this.starters.aworker.close(),
      this.launchQueue.close(),
    ]);
  }

  /**
   * Init (override)
   */
  async _init() {
    this.codeManager = this.plane.codeManager;
    this.functionProfile = this.plane.functionProfile;
    this.dataPlaneClientManager = this.plane.dataPlaneClientManager;
    this.snapshot = this.plane.capacityManager.workerStatsSnapshot;

    await Promise.all([
      this.starters.nodejs.ready(),
      this.starters.aworker.ready(),
    ]);
  }

  /**
   * Extract runtime type from profile object.
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile} profile The function profile object
   * @return {'nodejs' | 'aworker'} The runtime type.
   */
  extractRuntimeType(profile: RawFunctionProfile) {
    if (profile.runtime.startsWith('nodejs')) {
      return 'nodejs';
    } else if (profile.runtime.startsWith('aworker')) {
      return 'aworker';
    }

    const err = new Error(`Invalid runtime ${profile.runtime}.`);
    err.code = ErrorCode.kInvalidRuntime;
    throw err;
  }

  /**
   * Try launch worker process via turf
   * @param {string} funcName The function name.
   * @param {{ inspect?: boolean }} options The options object.
   * @return {Promise<void>} The result.
   */
  async tryLaunch(
    event: ControlPanelEvent,
    funcName: string,
    options: BaseOptions,
    disposable = false,
    toReserve = false,
    requestId?: string
  ) {
    return this.launchQueue.enqueue(
      {
        event,
        funcName,
        timestamp: Date.now(),
        disposable,
        options,
        requestId,
      },
      {
        priority: disposable
          ? Priority.kHigh
          : toReserve
          ? Priority.kLow
          : Priority.kNormal,
      }
    );
  }

  /**
   * Try launch worker process via turf
   */
  doTryLaunch = async (task: LaunchTask) => {
    const { event, requestId, funcName, disposable, options } = task;

    this.logger.info(
      'process launch event(%s), request(%s) func(%s), disposable(%s), priority(%s).',
      event,
      requestId,
      funcName,
      disposable
    );

    const pprofile = this.functionProfile.get(funcName);
    if (!pprofile) {
      const err = new Error(`No function named ${funcName}.`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const profile = pprofile.toJSON(true);
    const credential = naming.credential(funcName);
    const processName = naming.processName(funcName);
    const {
      dataPlaneClientManager,
      plane: { capacityManager },
    } = this;
    const {
      worker: { replicaCountLimit },
    } = profile;

    // get broker / virtualMemoryUsed / virtualMemoryPoolSize, etc.
    const broker = capacityManager.workerStatsSnapshot.getOrCreateBroker(
      funcName,
      !!options.inspect,
      profile.worker?.disposable
    );
    if (!broker) {
      const err = new Error(
        `No broker named ${funcName}, ${JSON.stringify(options)}`
      );
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const { virtualMemoryUsed, virtualMemoryPoolSize } = capacityManager;
    const {
      name,
      url,
      signature,
      resourceLimit: { memory = kMemoryLimit } = {},
    } = profile;
    if (virtualMemoryUsed + memory > virtualMemoryPoolSize) {
      const err = new Error(
        `No enough virtual memory (used: ${virtualMemoryUsed} + need: ${memory}) > total: ${virtualMemoryPoolSize}`
      );
      err.code = ErrorCode.kNoEnoughVirtualMemoryPoolSize;
      throw err;
    }

    let bundlePath;
    try {
      bundlePath = await this.codeManager.ensure(name, url, signature);
    } catch (exp) {
      const e = castError(exp);
      e.code = ErrorCode.kEnsureCodeError;
      throw e;
    }

    const starter: WorkerStarter =
      this.starters[this.extractRuntimeType(profile)];
    if (!starter) {
      const err = new Error(`Invalid runtime ${profile.runtime}.`);
      err.code = ErrorCode.kInvalidRuntime;
      throw err;
    }

    // inspect 模式只开启一个
    if (broker.workerCount && options.inspect) {
      const err = new Error(
        `Replica count exceeded limit in inspect mode (${broker.workerCount} / ${replicaCountLimit})`
      );
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }

    if (broker.workerCount >= replicaCountLimit) {
      const err = new Error(
        `Replica count exceeded limit (${broker.workerCount} / ${replicaCountLimit})`
      );
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }

    try {
      const now = performance.now();

      const dataPlane = await dataPlaneClientManager.registerWorkerCredential({
        funcName,
        processName,
        credential,
        inspect: !!options.inspect,
      });
      const serverSockPath = (dataPlane as any).getServerSockPath();

      const worker = this.snapshot.register(
        funcName,
        processName,
        credential,
        !!options.inspect,
        disposable
      );
      await starter.start(
        serverSockPath,
        processName,
        credential,
        profile,
        bundlePath,
        options
      );

      const started = performance.now();

      this.logger.info(
        'worker(%s, %s, %s, inspect %s, disposable %s) started, cost: %s, related request(%s)',
        funcName,
        processName,
        credential,
        options.inspect,
        disposable,
        performance.now() - now,
        requestId
      );

      await worker.ready();

      this.logger.info(
        'worker(%s, %s, inspect %s, disposable %s) ready, cost: %s, related request(%s)',
        funcName,
        credential,
        options.inspect,
        disposable,
        performance.now() - started,
        requestId
      );
    } catch (e) {
      this.snapshot.unregister(funcName, processName, !!options.inspect);
      throw e;
    }
  };
}

export interface WorkerLaunchItem {
  funcName: string;
  options: BaseOptions;
}

interface LaunchTask {
  event: ControlPanelEvent;
  timestamp: number;
  funcName: string;
  disposable: boolean;
  options: BaseOptions;
  requestId?: string;
}
