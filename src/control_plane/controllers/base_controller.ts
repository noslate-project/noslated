import { ControlPlaneEvent } from '#self/lib/constants';
import { Logger } from '#self/lib/loggers';
import { Delta } from '../capacity_manager';
import { WorkerMetadata } from '../worker_stats';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { ContainerManager } from '../container/container_manager';
import { ControlPlaneDependencyContext } from '../deps';
import { WorkerLauncher } from '../worker_launcher';
import { StateManager } from '../worker_stats/state_manager';

export abstract class BaseController {
  abstract logger: Logger;
  protected _functionProfile: FunctionProfileManager;
  protected _workerLauncher: WorkerLauncher;
  protected _containerManager: ContainerManager;
  protected _stateManager: StateManager;

  constructor(ctx: ControlPlaneDependencyContext) {
    this._functionProfile = ctx.getInstance('functionProfile');
    this._workerLauncher = ctx.getInstance('workerLauncher');
    this._containerManager = ctx.getInstance('containerManager');
    this._stateManager = ctx.getInstance('stateManager');
  }

  /**
   * Expand.
   * @param deltas Broker and its processes delta number.
   */
  protected async expand(deltas: Delta[]) {
    const expansions = [];
    for (let i = 0; i < deltas.length; i++) {
      const delta = deltas[i];
      if (delta.count > 0) {
        const workerMetadata = new WorkerMetadata(
          delta.broker.name,
          { inspect: delta.broker.isInspector },
          delta.broker.disposable,
          delta.broker.workerCount < delta.broker.reservationCount
        );
        expansions.push(this.tryBatchLaunch(workerMetadata, delta.count));
      }
    }
    await Promise.all(expansions);
  }

  /**
   * Try batchLaunch
   * @param functionName The function name.
   * @param count How many processes would be started.
   * @param options The options.
   */
  async tryBatchLaunch(
    workerMetadata: WorkerMetadata,
    count: number
  ): Promise<void[]> {
    const ret = [];
    for (let i = 0; i < count; i++) {
      ret.push(
        this._workerLauncher.tryLaunch(ControlPlaneEvent.Expand, workerMetadata)
      );
    }
    return Promise.all(ret);
  }

  /**
   * Destroy worker.
   */
  protected async stopWorker(workerName: string, requestId?: string) {
    const container = this._containerManager.getContainer(workerName);
    if (container == null) {
      return;
    }
    await container.stop();
    this.logger.info(
      'worker(%s) with request(%s) stopped.',
      workerName,
      requestId
    );
  }

  /**
   * Force stop all workers for functions
   */
  protected async stopAllWorkers(names: string[]) {
    if (names.length === 0) {
      return;
    }

    const stateManager = this._stateManager;
    const promises = [];
    this.logger.info('stop all worker of function %j', names);
    for (const name of names) {
      const brokers = [
        stateManager.getBroker(name, false),
        stateManager.getBroker(name, true),
      ];
      for (const broker of brokers) {
        if (!broker) continue;
        const { workers } = broker;
        for (const workerName of workers.keys()) {
          promises.push(this.stopWorker(workerName));
        }
      }
    }
    const results = await Promise.allSettled(promises);
    for (const ret of results) {
      if (ret.status === 'rejected') {
        this.logger.warn('Failed to force stop all workers.', ret.reason);
      }
    }
  }
}
