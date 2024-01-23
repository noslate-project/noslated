import { WorkerStatus } from '#self/lib/constants';
import {
  RawWithDefaultsFunctionProfile,
  ReadonlyProfile,
} from '#self/lib/json/function_profile';
import { Worker, WorkerMetadata } from './worker';
import { EMAConcurrency } from '#self/lib/ema_concurrency';

class Broker {
  redundantTimes: number;

  readonly name: string;
  readonly isInspector: boolean;
  #profile: RawWithDefaultsFunctionProfile;

  workers: Map<string, Worker>;

  private _initiatingWorkerCount = 0;
  private _activeWorkerCount = 0;
  private _emaConcurrency: EMAConcurrency | null = null;
  private _lastExpandTime: number;
  private _lastShrinkTime: number;

  constructor(
    profile: RawWithDefaultsFunctionProfile,
    isInspector: boolean,
    private _useEmaScaling: boolean
  ) {
    this.#profile = profile;
    this.name = this.#profile.name;
    this.isInspector = !!isInspector;

    if (this._useEmaScaling) {
      this._emaConcurrency = new EMAConcurrency(
        this.concurrencySlidingWindowSize,
        this.concurrencySlidingBucketCount,
        this.emaConcurrencyAlpha,
        this.precisionZeroThreshold
      );
    }

    this.workers = new Map();

    this.redundantTimes = 0;
    this._lastExpandTime = 0;
    // 开启时，启动后缩容进入冷却，防止 worker 被过快回收
    this._lastShrinkTime = this.shrinkCooldownOnStartup
      ? Date.now() + this.shrinkCooldown
      : 0;
  }

  get runtime() {
    return this.#profile.runtime;
  }

  /**
   * The reservation count of this broker.
   * @return {number} The reservation count.
   */
  get reservationCount() {
    if (this.isInspector) {
      return 1;
    }

    if (this.disposable) {
      return 0;
    }

    return this.#profile.worker.reservationCount;
  }

  get initializationTimeout() {
    return this.#profile.worker.initializationTimeout;
  }

  get profile(): ReadonlyProfile {
    return this.#profile;
  }

  get concurrencySlidingWindowSize() {
    return this.#profile.worker.concurrencySlidingWindowSize || 60 * 1000;
  }

  get concurrencySlidingBucketCount() {
    return this.#profile.worker.concurrencySlidingBucketCount || 6;
  }

  get emaConcurrencyAlpha() {
    return this.#profile.worker.emaConcurrencyAlpha || 0.5;
  }

  get concurrencyExpandThreshold() {
    return this.#profile.worker.concurrencyExpandThreshold || 0.7;
  }

  get concurrencyShrinkThreshold() {
    return this.#profile.worker.concurrencyShrinkThreshold || 0.3;
  }

  get expandCooldown() {
    return this.#profile.worker.expandCooldown || 1000;
  }

  get shrinkCooldown() {
    return this.#profile.worker.shrinkCooldown || 60 * 1000;
  }

  get scaleFactor() {
    return this.#profile.worker.scaleFactor || 0.5;
  }

  get precisionZeroThreshold() {
    return this.#profile.worker.precisionZeroThreshold || 0.01;
  }

  get shrinkCooldownOnStartup() {
    return this.#profile.worker.shrinkCooldownOnStartup || false;
  }

  isExpandCooldown(now: number) {
    return now - this._lastExpandTime < this.expandCooldown;
  }

  isShirnkCooldown(now: number) {
    return now - this._lastShrinkTime < this.shrinkCooldown;
  }

  resetExpandCooldownTime(now: number) {
    this._lastExpandTime = now;
  }

  resetShrinkCooldownTime(now: number) {
    this._lastShrinkTime = now;
  }

  /**
   * Register worker.
   * @param processName The process name (worker name).
   * @param credential The credential.
   */
  register(workerMetadata: WorkerMetadata): Worker {
    const worker = new Worker(workerMetadata, this.initializationTimeout);

    this.workers.set(workerMetadata.processName!, worker);

    worker.onstatuschanged = this._onstatuschanged;
    this._initiatingWorkerCount++;

    return worker;
  }

  private _onstatuschanged = (
    status: WorkerStatus,
    oldStatus: WorkerStatus
  ) => {
    if (oldStatus === WorkerStatus.Created) {
      this._initiatingWorkerCount--;
    } else if (oldStatus === WorkerStatus.Ready) {
      this._activeWorkerCount--;
    }

    if (status === WorkerStatus.Ready) {
      this._activeWorkerCount++;
    }
  };

  /**
   * @type {number}
   */
  get virtualMemory() {
    return this.activeWorkerCount * this.memoryLimit;
  }

  get memoryLimit(): number {
    return this.#profile.resourceLimit.memory;
  }

  get disposable(): boolean {
    return this.#profile.worker.disposable;
  }

  updateProfile(profile: RawWithDefaultsFunctionProfile) {
    if (profile.name !== this.name) {
      throw new Error(`Unexpected profile with name "${profile.name}"`);
    }
    this.#profile = profile;
  }

  get workerCount() {
    return this._activeWorkerCount + this._initiatingWorkerCount;
  }

  get initiatingWorkerCount() {
    return this._initiatingWorkerCount;
  }

  get activeWorkerCount() {
    return this._activeWorkerCount;
  }

  get totalMaxActivateRequests() {
    return this.profile.worker.maxActivateRequests * this._activeWorkerCount;
  }

  getActiveRequestCount() {
    let a = 0;
    for (const worker of this.workers.values()) {
      if (!worker.isActive()) continue;
      a += worker.data?.activeRequestCount || 0;
    }

    return a;
  }

  recalculateConcurrency(concurrency: number) {
    if (!this._useEmaScaling) return;

    this._emaConcurrency!.recalculate(concurrency);
  }

  getEMAConcurrency() {
    if (!this._useEmaScaling) return this.getActiveRequestCount();

    return this._emaConcurrency!.concurrency();
  }

  /**
   * Get worker.
   * @param processName The process name (worker name).
   * @return The matched worker object.
   */
  getWorker(processName: string) {
    return this.workers.get(processName) || null;
  }

  /**
   * Get the map key by function name and `isInspector`.
   * @param functionName The function name.
   * @param isInspector Whether it's using inspector or not.
   * @return The map key.
   */
  static getKey(functionName: string, isInspector: boolean) {
    return `${functionName}:${isInspector ? 'inspector' : 'noinspector'}`;
  }

  toJSON() {
    return {
      name: this.name,
      inspector: this.isInspector,
      profile: this.#profile,
      redundantTimes: this.redundantTimes,
      initiatingWorkerCount: this._initiatingWorkerCount,
      activeWorkerCount: this._activeWorkerCount,
      workers: Array.from(this.workers.values()).map(worker => worker.toJSON()),
    };
  }
}

export { Broker };
