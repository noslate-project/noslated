import { Clock, systemClock } from '#self/lib/clock';
import {
  TurfContainerStates,
  TurfProcess,
  TurfSpec,
  TurfState,
} from '#self/lib/turf/types';
import { Container, ContainerManager } from '../container/container_manager';
import SPEC from '../../lib/json/spec.template.json';
import { Broker } from '../worker_stats/broker';
import { createDeferred, Deferred } from '#self/lib/util';
import { StateManager } from '../worker_stats/state_manager';

export class TestContainerManager implements ContainerManager {
  containers = new Map<string, TestContainer>();

  constructor(public clock: Clock = systemClock) {}

  async ready(): Promise<void> {}
  async close(): Promise<void> {}

  setTestContainers(list: TurfProcess[]) {
    for (const it of list) {
      const container =
        this.containers.get(it.name) ??
        new TestContainer(it.name, '', SPEC, this);
      container.pid = it.pid;
      container.pendingStatus = it.status;
      this.containers.set(it.name, container);
    }
  }

  async spawn(
    name: string,
    bundlePath: string,
    spec: TurfSpec
  ): Promise<Container> {
    const container = new TestContainer(name, bundlePath, spec, this);
    this.containers.set(name, container);
    return container;
  }

  getContainer(name: string): Container | null {
    return this.containers.get(name) ?? null;
  }

  list(): Container[] {
    return Array.from(this.containers.values());
  }

  async reconcileContainers(): Promise<void> {
    for (const it of this.containers.values()) {
      it.updateStatus();
    }
  }
}

let id = 1;
beforeEach(() => {
  id = 1;
});
export class SimpleContainer implements Container {
  pid = id++;
  status = TurfContainerStates.init;

  pendingStatus = TurfContainerStates.init;
  private killed = false;
  terminated: Promise<TurfState | null>;
  private terminatedDeferred: Deferred<TurfState | null>;

  constructor(
    readonly name: string,
    readonly bundlePath?: string,
    readonly spec?: TurfSpec,
    private clock: Clock = systemClock
  ) {
    this.terminatedDeferred = createDeferred();
    this.terminated = this.terminatedDeferred.promise;
    this.pendingStatus = TurfContainerStates.starting;
    this.clock.setTimeout(() => {
      this.pendingStatus = TurfContainerStates.running;
    }, 10);
  }

  async stop(): Promise<void> {
    this.pendingStatus = TurfContainerStates.stopping;
    this.clock.setTimeout(() => {
      this.killed = true;
      this.pendingStatus = TurfContainerStates.stopped;
    }, 10);
  }

  async state(): Promise<TurfState> {
    const s: TurfState = {
      name: this.name,
      pid: this.pid,
      state: this.status,
      status: 0,
      'stat.utime': 0,
      'stat.stime': 0,
      'stat.cutime': 0,
      'stat.cstime': 0,
      'stat.vsize': 0,
      'stat.rss': 0,
      'stat.minflt': 0,
      'stat.majflt': 0,
      'stat.cminflt': 0,
      'stat.cmajflt': 0,
      'stat.num_threads': 0,
    };
    if (this.killed) {
      Object.assign(s, {
        'status.cpu_overload': '',
        'status.mem_overload': '',
        'status.killed': 1,
        'killed.signal': 15,
        exitcode: 0,
        'rusage.utime': 0,
        'rusage.stime': 0,
        'rusage.maxrss': 0,
      });
    }
    return s;
  }

  updateStatus(pendingStatus?: TurfContainerStates) {
    if (pendingStatus) {
      this.pendingStatus = pendingStatus;
    }
    if (this.status === this.pendingStatus) {
      return;
    }
    this.status = this.pendingStatus;
    if (
      [TurfContainerStates.stopped, TurfContainerStates.unknown].includes(
        this.status
      )
    ) {
      this._onStopped();
      this.terminatedDeferred.resolve(this.state());
    }
    this.onstatuschanged?.();
  }

  _onStopped() {}

  onstatuschanged?: () => void;
}

export class TestContainer extends SimpleContainer {
  constructor(
    name: string,
    bundlePath: string,
    spec: TurfSpec,
    private manager: TestContainerManager
  ) {
    super(name, bundlePath, spec, manager.clock);
  }

  _onStopped() {
    this.manager.containers.delete(this.name);
  }
}

export class NoopContainer implements Container {
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async state(): Promise<TurfState> {
    throw new Error('not implemented');
  }
  async delete(): Promise<void> {}
  async destroy(): Promise<void> {}

  onstatuschanged?: () => void;

  readonly name = 'noop_container';
  readonly status = TurfContainerStates.unknown;
  terminated: Promise<null> = Promise.resolve(null);
}

export function registerContainers(
  testContainerManager: TestContainerManager,
  stateManager: StateManager,
  list: TurfProcess[]
) {
  testContainerManager.list().forEach(it => {
    (it as TestContainer).pendingStatus = TurfContainerStates.unknown;
  });
  testContainerManager.setTestContainers(list);
  for (const broker of stateManager._brokers.values()) {
    for (const worker of broker.workers.values()) {
      const container = testContainerManager.getContainer(worker.name);
      if (container) {
        worker.setContainer(container);
      }
    }
  }
}
export function registerBrokerContainers(
  testContainerManager: TestContainerManager,
  broker: Broker,
  list: TurfProcess[]
) {
  testContainerManager.setTestContainers(list);
  for (const worker of broker.workers.values()) {
    const container = testContainerManager.getContainer(worker.name);
    if (container) {
      worker.setContainer(container);
    }
  }
}
