import EventEmitter from 'events';
import * as utils from '#self/lib/util';
import { TokenBucket, TokenBucketConfig } from './token_bucket';
import { RpcError, RpcStatus } from '#self/lib/rpc/error';
import { Base } from '#self/lib/sdk_base';
import { PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { Readable } from 'stream';
import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { NoslatedDelegateService } from '#self/delegate';
import { PrefixedLogger } from '#self/lib/loggers';
import { DataFlowController } from './data_flow_controller';
import * as root from '#self/proto/root';
import { performance } from 'perf_hooks';
import { WorkerStatusReport, kDefaultRequestId } from '#self/lib/constants';
import { DataPlaneHost } from './data_plane_host';
import { List, ReadonlyNode } from '#self/lib/list';
import { RawWithDefaultsFunctionProfile } from '#self/lib/json/function_profile';
import { Dispatcher, DispatcherDelegate } from './dispatcher/dispatcher';
import { DisposableDispatcher } from './dispatcher/disposable';
import { LeastRequestCountDispatcher } from './dispatcher/least_request_count';
import { RoundRobinDispatcher } from './dispatcher/round_robin';

enum CredentialStatus {
  PENDING = 1,
  BOUND = 2,
}

/**
 * The pending request.
 */
export class PendingRequest extends EventEmitter {
  startEpoch: number;
  available: boolean;
  input: Readable | Buffer;
  deferred: utils.Deferred<TriggerResponse>;
  timer: NodeJS.Timeout | undefined;
  requestId: string;

  constructor(
    inputStream: Readable | Buffer,
    public metadata: Metadata,
    deadline: number
  ) {
    super();
    this.startEpoch = Date.now();
    this.available = true;
    this.input = inputStream;
    this.deferred = utils.createDeferred<TriggerResponse>();
    this.requestId = metadata.requestId;
    this.timer = setTimeout(() => {
      this.available = false;
      this.emit('timeout');
    }, deadline - Date.now());
  }

  /**
   * Stop pending timeout timer.
   */
  stopTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * The promise that may response.
   */
  get promise(): Promise<TriggerResponse> {
    return this.deferred.promise;
  }

  /**
   * Resolve the `promise`.
   */
  get resolve(): (ret: TriggerResponse) => void {
    this.stopTimer();
    return this.deferred.resolve;
  }

  /**
   * Reject the `promise`.
   */
  get reject(): (err: Error) => void {
    this.stopTimer();
    return this.deferred.reject;
  }
}

export class Worker extends EventEmitter {
  activeRequestCount: number;
  private logger: PrefixedLogger;
  trafficOff: boolean;

  freeWorkerListNode: ReadonlyNode<Worker> | null = null;
  debuggerTag: string | undefined;

  private _dispatcherData: unknown;

  constructor(
    public delegate: NoslatedDelegateService,
    public name: string,
    public credential: string,
    public disposable: boolean
  ) {
    super();
    this.activeRequestCount = 0;
    this.logger = new PrefixedLogger('worker', this.name);

    // + if `trafficOff` is `false`, then traffic may in;
    // + if `trafficOff` is `true`, then traffic won't in;
    this.trafficOff = false;
  }

  getDispatcherData<T>() {
    return this._dispatcherData as T;
  }

  setDispatcherData<T>(val: T) {
    this._dispatcherData = val;
  }

  /**
   * Close this worker's traffic.
   */
  async closeTraffic() {
    this.trafficOff = true;

    if (this.activeRequestCount <= 0) {
      return Promise.resolve(true);
    }

    const { promise, resolve } = utils.createDeferred<boolean>();
    const downToZero: (...args: any[]) => void = () => {
      resolve(true);
    };

    this.once('downToZero', downToZero);

    return promise;
  }

  /**
   * Pipe input stream to worker process and get response.
   */
  invoke(inputStream: PendingRequest): Promise<TriggerResponse>;
  invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse>;
  async invoke(
    inputStream: Readable | Buffer | PendingRequest,
    metadata?: Metadata
  ): Promise<TriggerResponse> {
    let waitMs = 0;

    let requestId: string | undefined;

    if (inputStream instanceof PendingRequest) {
      metadata = inputStream.metadata;
      requestId = metadata.requestId;
      waitMs = Date.now() - inputStream.startEpoch;
      inputStream = inputStream.input;
    } else {
      requestId = metadata?.requestId;
    }

    requestId = requestId ?? kDefaultRequestId;
    if (this.disposable && metadata?.debuggerTag) {
      this.debuggerTag = metadata.debuggerTag;
      await this.delegate.inspectorStart(this.credential);
    }

    this.activeRequestCount++;
    this.logger.info(
      '[%s] Dispatching request, activeRequestCount: %s, wait: %sms.',
      requestId,
      this.activeRequestCount,
      waitMs
    );

    try {
      const ret = await this.delegate.trigger(
        this.credential,
        'invoke',
        inputStream,
        metadata || { requestId }
      );

      ret.queueing = waitMs;
      ret.workerName = this.name;

      // do not await the response body finishing.
      ret.finish().finally(() => {
        this.activeRequestCount--;
        if (this.activeRequestCount === 0) {
          this.emit('downToZero');
        }
      });

      return ret;
    } catch (e: unknown) {
      if (e instanceof Error) {
        e['queueing'] = waitMs;
        e['workerName'] = this.name;
      }
      this.activeRequestCount--;
      if (this.activeRequestCount === 0) {
        this.emit('downToZero');
      }
      throw e;
    }
  }
}

interface BrokerOptions {
  inspect?: boolean;
}

interface WorkerItem {
  status: CredentialStatus;
  name: string;
  worker: Worker | null;
}

/**
 * A container that brokers same function's workers.
 */
export class WorkerBroker extends Base implements DispatcherDelegate {
  public name: string;
  private delegate: NoslatedDelegateService;
  private host: DataPlaneHost;
  private logger: PrefixedLogger;
  requestQueue: List<PendingRequest>;

  private _dispatcher: Dispatcher;

  private _workerMap: Map<string, WorkerItem>;
  private tokenBucket: TokenBucket | undefined = undefined;

  /**
   * TODO(chengzhong.wcz): dependency review;
   */
  constructor(
    public dataFlowController: DataFlowController,
    private _profile: RawWithDefaultsFunctionProfile,
    public options: BrokerOptions = {}
  ) {
    super();

    this.name = _profile.name;
    this.delegate = dataFlowController.delegate;
    this.host = dataFlowController.host;

    this.logger = new PrefixedLogger(
      'worker broker',
      `${this.name}${options.inspect ? ':inspect' : ''}`
    );
    this.requestQueue = new List();

    this._workerMap = new Map();

    if (this.disposable) {
      this._dispatcher = new DisposableDispatcher(this);
    } else if (this._profile.worker.dispatchMode === 'round-robin') {
      this._dispatcher = new RoundRobinDispatcher(this);
    } else {
      this._dispatcher = new LeastRequestCountDispatcher(this);
    }

    const rateLimit = this.rateLimit;
    if (rateLimit) {
      this.tokenBucket = new TokenBucket(this.rateLimit as TokenBucketConfig);
    }
  }

  get workerCount() {
    return this._workerMap.size;
  }

  *workers() {
    for (const item of this._workerMap.values()) {
      if (item.worker) {
        yield item.worker;
      }
    }
  }

  /**
   * Get worker via only credential.
   */
  getWorker(credential: string) {
    const item = this._workerMap.get(credential);
    if (item == null) {
      return;
    }

    if (item.worker != null) {
      return item.worker;
    }

    return credential;
  }

  /**
   * Remove a worker via credential.
   */
  removeWorker(credential: string) {
    const item = this._workerMap.get(credential);
    this._workerMap.delete(credential);
    if (item?.worker == null) {
      return;
    }
    this._dispatcher.unregisterWorker(item.worker);
  }

  async closeTraffic(worker: Worker) {
    try {
      this._dispatcher.unregisterWorker(worker);
      await worker.closeTraffic();

      // 同步 RequestDrained
      this.host.broadcastContainerStatusReport({
        functionName: this.name,
        isInspector: this.options.inspect === true,
        name: worker.name,
        event: WorkerStatusReport.RequestDrained,
      });
    } catch (e) {
      this.logger.error(
        'unexpected error on closing worker traffic (%s, %s)',
        this.name,
        worker.name,
        e
      );
    }
  }

  /**
   * Get the pending credential.
   */
  private isCredentialPending(credential: string) {
    return this._workerMap.get(credential)?.status === CredentialStatus.PENDING;
  }

  /**
   * Register credential to this broker.
   * @param name The worker's name.
   * @param credential The worker's credential.
   */
  registerCredential(name: string, credential: string) {
    if (this.isCredentialPending(credential)) {
      throw new Error(
        `Credential ${credential} already exists in ${this.name}.`
      );
    }
    this._workerMap.set(credential, {
      status: CredentialStatus.PENDING,
      name,
      worker: null,
    });
  }

  updateProfile(profile: RawWithDefaultsFunctionProfile) {
    if (profile.name !== this.name) {
      throw new Error('Update with mismatched worker profile');
    }
    this._profile = profile;
  }

  get disposable() {
    return this._profile.worker.disposable;
  }

  /**
   * Rate limit of this broker.
   */
  get rateLimit() {
    return this._profile.rateLimit;
  }

  private get profile() {
    return this._profile;
  }

  get namespace() {
    return this._profile.namespace;
  }

  getWorkerInfo(credential: string) {
    const item = this._workerMap.get(credential);
    return item;
  }

  /**
   * Bind a worker to this broker and initialize.
   * @param credential The worker's credential.
   */
  async bindWorker(credential: string) {
    if (!this._workerMap.has(credential)) {
      this.logger.error(`No credential ${credential} bound to the broker.`);
      return;
    }

    const c = this.isCredentialPending(credential);
    if (!c) {
      throw new Error(
        `Credential ${credential} has not registered in ${this.name} yet.`
      );
    }

    const item = this._workerMap.get(credential);
    if (item == null || item.status !== CredentialStatus.PENDING) {
      this.logger.error(`Duplicated worker with credential ${credential}`);
      return;
    }

    const worker = new Worker(
      this.delegate,
      item.name,
      credential,
      this.disposable
    );

    try {
      const now = performance.now();
      await this.delegate.trigger(credential, 'init', null, {
        deadline: this.profile.worker.initializationTimeout + Date.now(),
      });
      this.logger.info(
        'worker(%s) initialization cost: %sms.',
        item.name,
        performance.now() - now
      );
      // 同步 Container 状态
      this.host.broadcastContainerStatusReport({
        functionName: this.name,
        isInspector: this.options.inspect === true,
        name: worker.name,
        event: WorkerStatusReport.ContainerInstalled,
      });
    } catch (e: any) {
      this.logger.debug('Unexpected error on invoking initializer', e.message);
      this.delegate.resetPeer(credential);
      throw e;
    }

    this._workerMap.set(credential, {
      status: CredentialStatus.BOUND,
      name: item.name,
      worker,
    });

    this._dispatcher.registerWorker(worker);
  }

  toJSON(): root.noslated.data.IBrokerStats {
    return {
      functionName: this.name,
      inspector: this.options.inspect === true,
      workers: Array.from(this._workerMap.values()).map(item => ({
        name: item.name,
        activeRequestCount: item.worker?.activeRequestCount ?? 0,
      })),
    };
  }

  // MARK: begin DispatcherDelegate
  get maxActiveRequestCount(): number {
    if (this.disposable) {
      return 1;
    }

    return this._profile.worker.maxActivateRequests;
  }

  get replicaCountLimit(): number {
    return this._profile.worker.replicaCountLimit;
  }

  getPendingRequestCount(): number {
    return this.requestQueue.length;
  }

  getPendingRequest(): PendingRequest | undefined {
    return this.requestQueue.shift();
  }

  /**
   * Check if request queue is enabled.
   */
  checkRequestQueueing(metadata: Metadata) {
    if (!this.profile.worker.disableRequestQueue) return;

    this.host.broadcastRequestQueueing(this, metadata.requestId);
    throw new Error(`No available worker process for ${this.name} now.`);
  }

  /**
   * Create a pending request to the queue.
   * @param input The input stream to be temporarily stored.
   * @param metadata The metadata.
   * @return The created pending request.
   */
  createPendingRequest(input: Readable | Buffer, metadata: Metadata) {
    this.logger.info('create pending request(%s).', metadata.requestId);
    const request = new PendingRequest(input, metadata, metadata.deadline);
    const node = this.requestQueue.push(request);
    this.dataFlowController.queuedRequestCounter.add(1, {
      [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
    });

    // TODO(kaidi.zkd): 统一计时器定时批量处理超时
    request.once('timeout', () => {
      this.logger.debug('A request wait timeout.');
      this.requestQueue.remove(node);
      request.reject(
        new RpcError(
          `Waiting for worker has timed out at ${metadata.deadline}, request(${request.requestId}).`,
          {
            code: RpcStatus.DEADLINE_EXCEEDED,
          }
        )
      );
      this.dataFlowController.queuedRequestDurationHistogram.record(
        Date.now() - request.startEpoch,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
        }
      );
    });

    // broadcast that there's no enough container
    this.host.broadcastRequestQueueing(this, request.requestId);
    return request;
  }

  // MARK: end DispatcherDelegate

  /**
   * Fast fail all pendings due to start error
   */
  fastFailAllPendingsDueToStartError(
    startWorkerFastFailRequest: root.noslated.data.IStartWorkerFastFailRequest
  ) {
    // If the error is fatal, reject all pending requests anyway.
    if (
      !startWorkerFastFailRequest.fatal &&
      !this.profile.worker.fastFailRequestsOnStarting
    )
      return;

    const requestQueue = this.requestQueue;
    this.requestQueue = new List();
    const err = new Error(startWorkerFastFailRequest.message!);
    for (const pendingRequest of requestQueue.values()) {
      pendingRequest.stopTimer();
      pendingRequest.reject(err);
      this.dataFlowController.queuedRequestDurationHistogram.record(
        Date.now() - pendingRequest.startEpoch,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
        }
      );
    }
  }

  /**
   * Invoke to an available worker if possible and response.
   */
  async invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse> {
    await this.ready();
    const acquiredToken = this.tokenBucket?.acquire() ?? true;
    if (!acquiredToken) {
      throw new RpcError('rate limit exceeded', {
        code: RpcStatus.RESOURCE_EXHAUSTED,
      });
    }

    return this._dispatcher.invoke(inputStream, metadata);
  }

  /**
   * Init (override)
   */
  async _init() {
    this.tokenBucket?.start();
  }

  /**
   * Close (override)
   */
  _close() {
    this.tokenBucket?.close();
    // TODO: close all pending & active requests.
  }
}
