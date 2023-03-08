import { Base } from '#self/lib/sdk_base';
import { castError } from '#self/lib/util';
import loggers from '#self/lib/logger';
import * as naming from '#self/lib/naming';
import * as starters from './starter';
import { ErrorCode } from './worker_launcher_error_code';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { BaseOptions } from './starter/base';
import { CodeManager } from './code_manager';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { DataPlaneClientManager } from './data_plane_client/manager';
import { WorkerMetadata } from './worker_stats/index';
import { performance } from 'perf_hooks';
import { ControlPlaneEvent } from '#self/lib/constants';
import { Priority, TaskQueue } from '#self/lib/task_queue';
import { Container } from './container/container_manager';
import { ControlPlaneDependencyContext } from './deps';
import { CapacityManager } from './capacity_manager';
import { StateManager } from './worker_stats/state_manager';

export interface WorkerStarter {
  start(
    serverSockPath: string,
    name: string,
    credential: string,
    profile: RawFunctionProfile,
    bundlePath: string,
    options: BaseOptions
  ): Promise<Container>;
}

export class WorkerLauncher extends Base {
  private logger;
  private config;
  starters;
  private codeManager: CodeManager;
  private functionProfile: FunctionProfileManager;
  private dataPlaneClientManager: DataPlaneClientManager;
  private capacityManager: CapacityManager;
  private stateManager: StateManager;
  private launchQueue: TaskQueue<LaunchTask>;

  constructor(ctx: ControlPlaneDependencyContext) {
    super();
    this.config = ctx.getInstance('config');
    this.codeManager = ctx.getInstance('codeManager');
    this.functionProfile = ctx.getInstance('functionProfile');
    this.dataPlaneClientManager = ctx.getInstance('dataPlaneClientManager');
    this.capacityManager = ctx.getInstance('capacityManager');
    this.stateManager = ctx.getInstance('stateManager');

    this.logger = loggers.get('worker launcher');

    this.starters = {
      nodejs: new starters.Nodejs(ctx),
      aworker: new starters.Aworker(ctx),
    };

    this.launchQueue = new TaskQueue(this.doLauchTask, {
      concurrency: this.config.controlPlane.expandConcurrency,
      clock: ctx.getInstance('clock'),
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
   * @param {ControlPlaneEvent} event The event.
   * @param {WorkerMetadata} workerMetadata The worker init data.
   * @return {Promise<void>} The result.
   */
  async tryLaunch(event: ControlPlaneEvent, workerMetadata: WorkerMetadata) {
    const { funcName, disposable, options, requestId, toReserve } =
      workerMetadata;

    return this.launchQueue.enqueue(
      {
        event,
        funcName,
        timestamp: Date.now(),
        disposable,
        options,
        toReserve,
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
  doLauchTask = async (task: LaunchTask) => {
    const { event, requestId, funcName, disposable, options, toReserve } = task;

    this.logger.info(
      'process launch event(%s), request(%s) func(%s), disposable(%s), priority(%s).',
      event,
      requestId,
      funcName,
      disposable,
      disposable ? Priority.kHigh : toReserve ? Priority.kLow : Priority.kNormal
    );

    const pprofile = this.functionProfile.get(funcName);
    if (!pprofile) {
      const err = new Error(`No function named ${funcName}.`);
      err.code = ErrorCode.kNoFunction;
      throw err;
    }

    const profile = pprofile.toJSON(true);
    this.capacityManager.assertExpandingAllowed(
      funcName,
      !!options.inspect,
      disposable,
      profile
    );

    const credential = naming.credential(funcName);
    const processName = naming.processName(funcName);
    const { name, url, signature } = profile;

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

    const dataPlane =
      await this.dataPlaneClientManager.registerWorkerCredential({
        funcName,
        processName,
        credential,
        inspect: !!options.inspect,
      });
    const serverSockPath = (dataPlane as any).getServerSockPath();

    const workerMetadata = new WorkerMetadata(
      funcName,
      { inspect: !!options.inspect },
      disposable,
      !!toReserve,
      processName,
      credential,
      requestId
    );

    const worker =
      this.stateManager.workerStatsSnapshot.register(workerMetadata);

    try {
      const now = performance.now();
      const container = await starter.start(
        serverSockPath,
        processName,
        credential,
        profile,
        bundlePath,
        options
      );
      worker.setContainer(container);
      worker.logger.start(performance.now() - now);
    } catch (e) {
      worker.updateWorkerStatusByControlPlaneEvent(
        ControlPlaneEvent.FailedToSpawn
      );
      throw e;
    }

    const started = performance.now();
    await worker.ready();
    worker.logger.ready(performance.now() - started);
  };
}

export interface WorkerLaunchItem {
  funcName: string;
  options: BaseOptions;
}

interface LaunchTask {
  event: ControlPlaneEvent;
  timestamp: number;
  funcName: string;
  disposable: boolean;
  options: BaseOptions;
  requestId?: string;
  toReserve?: boolean;
}
