import { Base } from '#self/lib/sdk_base';
import { castError, createDeferred } from '#self/lib/util';
import loggers from '#self/lib/logger';
import * as naming from '#self/lib/naming';
import * as starters from './starter';
import { turf } from '#self/lib/turf';
import { ErrorCode } from './worker_launcher_error_code';
import { ControlPanel } from './control_panel';
import { Config } from '#self/config';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { BaseOptions } from './starter/base';
import { CodeManager } from './code_manager';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { DataPanelClientManager } from './data_panel_client/manager';
import { WorkerStatsSnapshot } from './worker_stats';
import { kMemoryLimit } from './constants';
import { LaunchTask, PriorityLaunchQueue, TaskPriority } from './priority_launch_queue';
import { performance } from 'perf_hooks';

export interface WorkerStarter {
  start(serverSockPath: string, name: string, credential: string, profile: RawFunctionProfile, bundlePath: string, options: BaseOptions): Promise<void>;
}

export class WorkerLauncher extends Base {
  panel;
  logger;
  config;
  starters;
  codeManager!: CodeManager;
  functionProfile!: FunctionProfileManager;
  dataPanelClientManager!: DataPanelClientManager;
  snapshot!: WorkerStatsSnapshot;
  priorityLaunchQueue: PriorityLaunchQueue;

  /**
   * Constructor
   * @param {import('./control_panel').ControlPanel} panel The panel object.
   * @param {typeof import('#self/config/default')} config The global config object.
   */
  constructor(panel: ControlPanel, config: Config) {
    super();
    this.panel = panel;

    this.logger = loggers.get('worker launcher');
    this.config = config;

    this.starters = {
      nodejs: new starters.Nodejs(panel, config),
      aworker: new starters.Aworker(panel, config),
    };

    this.priorityLaunchQueue = new PriorityLaunchQueue(config.controlPanel.expandConcurrency, config.controlPanel.expandInterval);
  }

  /**
   * Close (override)
   */
  async _close() {
    await Promise.all([
      this.starters.nodejs.close(),
      this.starters.aworker.close(),
      this.priorityLaunchQueue.stop()
    ]);
  }

  /**
   * Init (override)
   */
  async _init() {
    this.codeManager = this.panel.codeManager;
    this.functionProfile = this.panel.functionProfile;
    this.dataPanelClientManager = this.panel.dataPanelClientManager;
    this.snapshot = this.panel.capacityManager.workerStatsSnapshot;

    if (this.config.turf.deleteAllContainersBeforeStart) {
      await turf.destroyAll();
    }

    await Promise.all([
      this.starters.nodejs.ready(),
      this.starters.aworker.ready(),
      this.priorityLaunchQueue.start()
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
  async tryLaunch(funcName: string, options: BaseOptions, useCGIMode: boolean = false, toReserve: boolean = false, requestId?: string) {
    const { promise, resolve, reject } = createDeferred<void>();
    this.priorityLaunchQueue.enqueue({
      functionName: funcName,
      timestamp: performance.now(),
      priority: useCGIMode ? TaskPriority.HIGH : (toReserve ? TaskPriority.LOW : TaskPriority.NORMAL),
      useCGIMode,
      options,
      requestId,
      processer: async (task: LaunchTask, queue: PriorityLaunchQueue) => {
        this.logger.info('process launch request(%s) func(%s), useCGIMode(%s), priority(%s).',task.requestId, task.functionName, task.useCGIMode, TaskPriority[task.priority]);
        try {
          await this.doTryLaunch(task.functionName, task.options, task.useCGIMode, task.requestId);
          resolve();
        } catch (error) {
          return reject(error);
        }
      }
    });

    return promise;
  }

  /**
   * Try launch worker process via turf
   * @param {string} funcName The function name.
   * @param {{ inspect?: boolean }} options The options object.
   * @return {Promise<void>} The result.
   */
  async doTryLaunch(funcName: string, options: BaseOptions, useCGIMode: boolean, requestId?: string) {
    let pprofile = this.functionProfile.get(funcName);
    if (!pprofile) {
      const err = new Error(`No function named ${funcName}.`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const profile = pprofile.toJSON(true);
    const credential = naming.credential(funcName);
    const processName = naming.processName(funcName);
    const { dataPanelClientManager, panel: { capacityManager } } = this;
    const { worker: { replicaCountLimit } } = profile;

    // get broker / virtualMemoryUsed / virtualMemoryPoolSize, etc.
    const broker = capacityManager.workerStatsSnapshot.getOrCreateBroker(funcName, !!options.inspect, profile.worker?.useCGIMode);
    if (!broker) {
      const err = new Error(`No broker named ${funcName}, ${JSON.stringify(options)}`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const { virtualMemoryUsed, virtualMemoryPoolSize } = capacityManager;
    const { name, url, signature, resourceLimit: { memory = kMemoryLimit } = {} } = profile;
    if (virtualMemoryUsed + memory > virtualMemoryPoolSize) {
      const err = new Error(
        `No enough virtual memory (used: ${virtualMemoryUsed} + need: ${memory}) > total: ${virtualMemoryPoolSize}`);
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

    const starter: WorkerStarter = this.starters[this.extractRuntimeType(profile)];
    if (!starter) {
      const err = new Error(`Invalid runtime ${profile.runtime}.`);
      err.code = ErrorCode.kInvalidRuntime;
      throw err;
    }

    // inspect 模式只开启一个
    if (broker.workerCount && options.inspect) {
      const err = new Error(
        `Replica count exceeded limit in inspect mode (${broker.workerCount} / ${replicaCountLimit})`);
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }

    if (broker.workerCount >= replicaCountLimit) {
      const err = new Error(`Replica count exceeded limit (${broker.workerCount} / ${replicaCountLimit})`);
      err.code = ErrorCode.kReplicaLimitExceeded;
      throw err;
    }

    try {
      const now = performance.now();

      const dataPanel = await dataPanelClientManager.registerWorkerCredential({
        funcName,
        processName,
        credential,
        inspect: !!options.inspect,
      });
      const serverSockPath = (dataPanel as any).getServerSockPath();

      this.snapshot.register(funcName, processName, credential, !!options.inspect, useCGIMode);
      await starter.start(serverSockPath, processName, credential, profile, bundlePath, options);

      this.logger.info('worker(%s, %s, inspect %s, useCGIMode %s) started, cost: %s, related request(%s)', funcName, credential, options.inspect, useCGIMode, performance.now() - now, requestId);
    } catch (e) {
      this.snapshot.unregister(funcName, processName, !!options.inspect);
      throw e;
    }
  }
}

export interface WorkerLaunchItem {
  funcName: string;
  options: BaseOptions;
}
