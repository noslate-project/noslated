import { TurfContainerStates } from '#self/lib/turf/types';
import type { noslated } from '#self/proto/root';
import {
  WorkerStatus,
  WorkerStatusReport,
  TurfStatusEvent,
  ControlPlaneEvent,
} from '#self/lib/constants';
import { createDeferred, Deferred } from '#self/lib/util';
import { Container } from '../container/container_manager';
import assert from 'assert';
import { WorkerLogger } from './worker_logger';

export type WorkerStats = noslated.data.IWorkerStats;

class WorkerAdditionalData {
  activeRequestCount;

  constructor(data: WorkerStats) {
    this.activeRequestCount = data.activeRequestCount;
  }
}

type WorkerOption = {
  inspect: boolean;
};
class WorkerMetadata {
  readonly credential: string | null;
  readonly processName: string | null;

  // TODO(yilong.lyl): simplify constructor params
  constructor(
    readonly funcName: string,

    readonly options: WorkerOption = { inspect: false },
    readonly toReserve = false,

    _processName?: string,
    _credential?: string,
    readonly requestId?: string
  ) {
    this.processName = _processName ?? null;
    this.credential = _credential ?? null;
  }
}

class Worker {
  /**
   * Underlying turf container.
   */
  container?: Container;

  #workerStatus: WorkerStatus;

  get workerStatus() {
    return this.#workerStatus;
  }

  /**
   * The container states.
   */
  #turfContainerStates: TurfContainerStates | null;

  /**
   * The container states.
   */
  get turfContainerStates() {
    return this.#turfContainerStates;
  }

  /**
   * The replica name.
   */
  #name: string;

  /**
   * The replica name.
   */
  get name() {
    return this.#name;
  }

  /**
   * The credential.
   */
  #credential: string | null;

  /**
   * The credential.
   */
  get credential() {
    return this.#credential;
  }

  /**
   * The pid.
   */
  #pid: number | null;

  /**
   * The pid.
   */
  private get pid() {
    return this.#pid;
  }

  /**
   * The worker additional data.
   */
  #data: WorkerAdditionalData | null;

  /**
   * The worker additional data.
   */
  get data() {
    return this.#data;
  }

  /**
   * The register time.
   */
  #registerTime: number;

  /**
   * The register time.
   */
  get registerTime() {
    return this.#registerTime;
  }

  #readyCalled = false;
  #readyDeferred: Deferred<void>;
  #initializationTimeout: number;

  logger: WorkerLogger;
  requestId: string | undefined;
  private readyTimeout: NodeJS.Timeout | undefined;

  onstatuschanged: (newStatus: WorkerStatus, oldStatus: WorkerStatus) => void =
    () => {};

  /**
   * Constructor
   * @param config The global configure.
   * @param name The worker name (replica name).
   * @param credential The credential.
   */
  constructor(workerMetadata: WorkerMetadata, initializationTimeout: number) {
    this.#name = workerMetadata.processName!;
    this.#credential = workerMetadata.credential ?? null;

    this.#turfContainerStates = null;
    this.#pid = null;
    this.#data = null;
    this.#workerStatus = WorkerStatus.Created;

    this.#registerTime = Date.now();

    this.#initializationTimeout = initializationTimeout;
    this.requestId = undefined;

    this.#readyDeferred = createDeferred<void>();

    this.logger = new WorkerLogger(workerMetadata);
  }

  async ready() {
    if (this.#readyCalled) {
      return this.#readyDeferred.promise;
    }

    // 在 await ready 之前状态已经改变了
    if (this.#workerStatus >= WorkerStatus.Ready) {
      this.logger.statusChangedBeforeReady(WorkerStatus[this.#workerStatus]);

      if (this.#workerStatus >= WorkerStatus.PendingStop) {
        this.#readyDeferred.reject(
          new Error(
            `Worker(${this.name}, ${this.credential}) stopped before ready.`
          )
        );
      } else {
        this.#readyDeferred.resolve();
      }

      return this.#readyDeferred.promise;
    }

    // +100 等待 dp 先触发超时逻辑同步状态
    this.readyTimeout = setTimeout(() => {
      if (this.#workerStatus !== WorkerStatus.Ready) {
        // 状态设为 PendingStop, GC 回收
        this.#readyDeferred.reject(
          new Error(
            `Worker(${this.name}, ${this.credential}) initialization timeout.`
          )
        );
        this._updateWorkerStatus(
          WorkerStatus.PendingStop,
          ControlPlaneEvent.InitializationTimeout
        );
      }
    }, this.#initializationTimeout + 100);

    return this.#readyDeferred.promise.finally(() => {
      if (this.readyTimeout) {
        clearTimeout(this.readyTimeout);
        this.readyTimeout = undefined;
      }
    });
  }

  setContainer(container: Container) {
    this.container = container;
    container.onstatuschanged = () => {
      if (container.pid) {
        this.#pid = container.pid;
      }
      this._switchTo(container.status);
    };
    if (container.pid) {
      this.#pid = container.pid;
    }
    this._switchTo(container.status);
  }

  toJSON() {
    return {
      name: this.name,
      credential: this.credential,
      pid: this.pid,

      turfContainerStates: this.turfContainerStates,
      containerStatus: this.#workerStatus,

      registerTime: this.registerTime,

      data: this.data
        ? {
            activeRequestCount: this.data.activeRequestCount,
          }
        : null,
    };
  }

  async stop() {
    assert.ok(this.container != null, 'Worker has not bound to a container');
    return this.container?.stop();
  }

  /**
   * Sync data from data plane.
   * @param data The data object.
   * @param psData The turf ps data.
   */
  sync(data: WorkerStats | null) {
    this.#data = data ? new WorkerAdditionalData(data) : null;
  }

  /**
   * turf 状态仅做参考
   * Switch worker's status to another via a state machine.
   * @param found The found ps data.
   */
  private _switchTo(turfState: TurfContainerStates) {
    this.#turfContainerStates = turfState;
    if (turfState < TurfContainerStates.stopping) {
      return;
    }
    if (turfState === TurfContainerStates.unknown) {
      this._updateWorkerStatus(
        WorkerStatus.Unknown,
        TurfStatusEvent.StatusUnknown
      );
      return;
    }
    this._updateWorkerStatus(
      WorkerStatus.Stopped,
      TurfStatusEvent.StatusStopped
    );
  }

  /**
   * Worker is active for processing requests.
   */
  isActive() {
    return this.#workerStatus === WorkerStatus.Ready;
  }

  updateWorkerStatusByReport(event: WorkerStatusReport) {
    let statusTo: WorkerStatus;

    switch (event) {
      case WorkerStatusReport.ContainerInstalled:
        statusTo = WorkerStatus.Ready;
        break;
      case WorkerStatusReport.RequestDrained:
      case WorkerStatusReport.ContainerDisconnected:
        statusTo = WorkerStatus.PendingStop;
        break;
      default:
        throw new Error(`Unrecognizable WorkerStatusReport(${event})`);
    }

    this._updateWorkerStatus(statusTo, event);
  }

  updateWorkerStatusByControlPlaneEvent(event: ControlPlaneEvent) {
    let status: WorkerStatus;
    switch (event) {
      case ControlPlaneEvent.FunctionRemoved:
      case ControlPlaneEvent.Shrink:
        status = WorkerStatus.PendingStop;
        break;
      case ControlPlaneEvent.FailedToSpawn:
        status = WorkerStatus.Unknown;
        break;
      case ControlPlaneEvent.Stopping:
        status = WorkerStatus.Stopping;
        break;
      case ControlPlaneEvent.Terminated:
        status = WorkerStatus.Stopped;
        break;
      default:
        throw new Error(`Unable to update worker status by event ${event}`);
    }
    this._updateWorkerStatus(status, event);
  }

  private _updateWorkerStatus(
    status: WorkerStatus,
    event: TurfStatusEvent | WorkerStatusReport | ControlPlaneEvent
  ) {
    if (status === this.#workerStatus) {
      return;
    }
    if (status < this.#workerStatus) {
      this.logger.updateWorkerStatus(
        status,
        this.#workerStatus,
        event,
        'warn',
        ' is ignored.'
      );
      return;
    }

    const oldStatus = this.#workerStatus;
    this.#workerStatus = status;

    this.logger.updateWorkerStatus(status, oldStatus, event);
    try {
      this.onstatuschanged(status, oldStatus);
    } catch (e) {
      this.logger.statusChangedError(e);
    }

    if (oldStatus >= WorkerStatus.Ready) {
      return;
    }
    if (status !== WorkerStatus.Ready) {
      this.#readyDeferred.reject(
        new Error(
          `Worker(${this.name}, status ${status}) stopped unexpected after start.`
        )
      );
    } else {
      this.#readyDeferred.resolve();
    }
  }
}

export { Worker, WorkerAdditionalData, WorkerMetadata as WorkerMetadata };
