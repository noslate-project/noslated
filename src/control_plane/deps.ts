import { config, Config } from '#self/config';
import { Clock, systemClock } from '#self/lib/clock';
import {
  InjectableConstructor,
  DependencyContext,
  StringKeyOf,
} from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Meter } from '@opentelemetry/api';
import { CapacityManager } from './capacity_manager';
import { CodeManager } from './code_manager';
import { ContainerManager } from './container/container_manager';
import { TurfContainerManager } from './container/turf_container_manager';
import {
  DefaultController,
  DisposableController,
  ReservationController,
} from './controllers';
import { DataPlaneClientManager } from './data_plane_client/manager';
import { events } from './events';
import { Herald } from './herald';
import { WorkerLauncher } from './worker_launcher';
import { StateManager } from './worker_stats/state_manager';

export type ConfigContext = {
  config: Config;
};
export type ControlPlaneDeps = {
  config: Config;
  clock: Clock;
  eventBus: EventBus;
  containerManager: ContainerManager;
  meter: Meter;
  dataPlaneClientManager: DataPlaneClientManager;
  herald: Herald;
  codeManager: CodeManager;
  functionProfile: FunctionProfileManager;
  workerLauncher: WorkerLauncher;
  capacityManager: CapacityManager;
  stateManager: StateManager;

  defaultController: DefaultController;
  reservationController: ReservationController;
  disposableController: DisposableController;
};
export type ConfigurableControlPlaneDeps = Partial<
  Pick<
    ControlPlaneDeps,
    'config' | 'clock' | 'containerManager' | 'dataPlaneClientManager'
  >
>;

export class ControlPlaneDependencyContext extends DependencyContext<
  ControlPlaneDeps,
  ControlPlaneDependencyContext
> {
  constructor(partials?: ConfigurableControlPlaneDeps) {
    super();
    this.bindInstance('clock', partials?.clock ?? systemClock);
    this.bindInstance('config', partials?.config ?? config);
    this.maybeBind(
      'containerManager',
      partials?.containerManager,
      TurfContainerManager
    );
    this.maybeBind(
      'dataPlaneClientManager',
      partials?.dataPlaneClientManager,
      DataPlaneClientManager
    );

    this.bindInstance('eventBus', new EventBus(events));
    this.bind('herald', Herald);
    this.bind('codeManager', CodeManager);
    this.bind('functionProfile', FunctionProfileManager);
    this.bind('workerLauncher', WorkerLauncher);
    this.bind('capacityManager', CapacityManager);
    this.bind('stateManager', StateManager);
    this.bind('defaultController', DefaultController);
    this.bind('reservationController', ReservationController);
    this.bind('disposableController', DisposableController);
  }

  maybeBind<K extends StringKeyOf<ControlPlaneDeps>>(
    key: K,
    ins: ControlPlaneDeps[K] | undefined,
    cons: InjectableConstructor<
      ControlPlaneDeps[K],
      ControlPlaneDependencyContext
    >
  ) {
    if (ins) {
      this.bindInstance(key, ins);
      return;
    }
    this.bind(key, cons);
  }
}
