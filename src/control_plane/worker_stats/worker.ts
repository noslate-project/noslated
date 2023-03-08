import { TurfContainerStates } from '#self/lib/turf/types';
import type { noslated } from '#self/proto/root';
import { Config } from '#self/config';
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
  maxActivateRequests;
  activeRequestCount;

  constructor(data: WorkerStats) {
    this.maxActivateRequests = data.maxActivateRequests;
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
    readonly disposable = false,
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

  #readyDeferred: Deferred<void>;
  #initializationTimeout: number;

  logger: WorkerLogger;
  requestId: string | undefined;
  private readyTimeout: NodeJS.Timeout | undefined;

  public disposable = false;

  /**
   * Constructor
   * @param config The global configure.
   * @param name The worker name (replica name).
   * @param credential The credential.
   */
  constructor(
    workerMetadata: WorkerMetadata,
    config: Config,
    initializationTimeout?: number
  ) {
    this.disposable = workerMetadata.disposable;
    this.#name = workerMetadata.processName!;
    this.#credential = workerMetadata.credential ?? null;

    this.#turfContainerStates = null;
    this.#pid = null;
    this.#data = null;
    this.#workerStatus = WorkerStatus.Created;

    this.#registerTime = Date.now();

    this.#initializationTimeout =
      initializationTimeout ?? config.worker.defaultInitializerTimeout;

    this.requestId = undefined;

    this.#readyDeferred = createDeferred<void>();

    this.logger = new WorkerLogger(workerMetadata);
  }

  async ready() {
    // 在 await ready 之前状态已经改变了
    if (this.#workerStatus >= WorkerStatus.Ready) {
      this.logger.statusChangedBeforeReady(WorkerStatus[this.#workerStatus]);

      if (this.#workerStatus >= WorkerStatus.PendingStop) {
        this.#readyDeferred.reject();
      }

      this.#readyDeferred.resolve();

      return this.#readyDeferred.promise;
    }

    // +100 等待 dp 先触发超时逻辑同步状态
    this.readyTimeout = setTimeout(() => {
      if (this.#workerStatus !== WorkerStatus.Ready) {
        // 状态设为 Stopped，等待 GC 回收
        this.#readyDeferred.reject(
          new Error(
            `Worker(${this.name}, ${this.credential}) initialization timeout.`
          )
        );
        this._updateWorkerStatus(
          WorkerStatus.Stopped,
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

  private _setReady() {
    this.#readyDeferred.resolve();
  }

  private _setStopped() {
    this.#readyDeferred.reject(
      new Error(
        `Worker(${this.name}, ${this.credential}) stopped unexpected after start.`
      )
    );
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
            maxActivateRequests: this.data.maxActivateRequests,
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
  private _switchTo(turfState: TurfContainerStates | null) {
    this.#turfContainerStates = turfState;
    switch (turfState) {
      case TurfContainerStates.init:
      case TurfContainerStates.starting:
      case TurfContainerStates.cloning:
      case TurfContainerStates.running: {
        if (
          Date.now() - this.#registerTime > this.#initializationTimeout &&
          this.#workerStatus === WorkerStatus.Created
        ) {
          this._updateWorkerStatus(
            WorkerStatus.Stopped,
            ControlPlaneEvent.InitializationTimeout
          );
          this.logger.statusSwitchTo(WorkerStatus.Stopped, 'connect timeout');
        }
        // always be Created, wait dp ContainerInstalled to Ready
        break;
      }
      case TurfContainerStates.unknown: {
        this._updateWorkerStatus(
          WorkerStatus.Unknown,
          TurfStatusEvent.StatusUnknown
        );
        this.logger.statusSwitchTo(
          WorkerStatus.Unknown,
          'turf state is unknown',
          'error'
        );
        break;
      }
      case TurfContainerStates.stopping:
      case TurfContainerStates.stopped: {
        this.logger.statusSwitchTo(
          WorkerStatus.Stopped,
          'turf state is stopped/stopping'
        );
        this._updateWorkerStatus(
          WorkerStatus.Stopped,
          TurfStatusEvent.StatusStopped
        );
        break;
      }
      case null: {
        // 只有 Ready 运行时无法找到的情况视为异常
        // 其他情况不做处理
        if (this.#workerStatus === WorkerStatus.Ready) {
          this.logger.statusSwitchTo(
            WorkerStatus.Stopped,
            'sandbox disappeared'
          );
          this._updateWorkerStatus(
            WorkerStatus.Stopped,
            TurfStatusEvent.StatusNull
          );
        }
        break;
      }
      case TurfContainerStates.forkwait:
        //这个状态不需要处理，仅 seed 会存在
        break;
      default:
        this.logger.foundTurfState(turfState);

        if (
          Date.now() - this.#registerTime > this.#initializationTimeout &&
          this.#workerStatus === WorkerStatus.Created
        ) {
          this._updateWorkerStatus(
            WorkerStatus.Stopped,
            ControlPlaneEvent.InitializationTimeout
          );
          this.logger.statusSwitchTo(WorkerStatus.Stopped, 'connect timeout');
        }
    }
  }

  /**
   * Whether this worker is running.
   */
  isRunning() {
    return (
      this.#workerStatus === WorkerStatus.Ready ||
      this.#workerStatus === WorkerStatus.PendingStop
    );
  }

  isInitializating() {
    return this.#workerStatus === WorkerStatus.Created;
  }

  updateWorkerStatusByReport(event: WorkerStatusReport) {
    let statusTo: WorkerStatus = WorkerStatus.Unknown;

    if (event === WorkerStatusReport.ContainerInstalled) {
      statusTo = WorkerStatus.Ready;
    } else if (
      // FIXME: WorkerStatusReport.RequestDrained doesn't represent WorkerStatus.Stopped.
      event === WorkerStatusReport.RequestDrained ||
      event === WorkerStatusReport.ContainerDisconnected
    ) {
      statusTo = WorkerStatus.Stopped;
    } else {
      statusTo = WorkerStatus.Unknown;
    }

    this._updateWorkerStatus(statusTo, event);
  }

  updateWorkerStatusByControlPlaneEvent(event: ControlPlaneEvent) {
    let status: WorkerStatus;
    switch (event) {
      case ControlPlaneEvent.Shrink:
        status = WorkerStatus.PendingStop;
        break;
      case ControlPlaneEvent.FailedToSpawn:
        status = WorkerStatus.Unknown;
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
    if (status < this.#workerStatus) {
      this.logger.updateContainerStatus(
        status,
        this.#workerStatus,
        event,
        'warn',
        ' is illegal.'
      );
      return;
    }

    const oldStatus = this.#workerStatus;

    this.#workerStatus = status;

    this.logger.updateContainerStatus(status, oldStatus, event);

    if (status === WorkerStatus.Stopped) {
      this._setStopped();
    } else if (status === WorkerStatus.Ready) {
      this._setReady();
    }
  }
}

export { Worker, WorkerAdditionalData, WorkerMetadata as WorkerMetadata };
