import { ControlPlaneEvent } from '#self/lib/constants';
import { Logger } from '#self/lib/loggers';
import { Delta } from '../capacity_manager';
import { WorkerMetadata } from '../worker_stats/worker';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { ContainerManager } from '../container/container_manager';
import { ControlPlaneDependencyContext } from '../deps';
import { WorkerLauncher } from '../worker_launcher';
import { StateManager } from '../worker_stats/state_manager';

export abstract class BaseController {
  protected abstract logger: Logger;
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
}
