import EventEmitter from 'events';
import _ from 'lodash';
import * as utils from '#self/lib/util';
import { TokenBucket, TokenBucketConfig } from './token_bucket';
import { RpcError, RpcStatus } from '#self/lib/rpc/error';
import { Base } from '#self/lib/sdk_base';
import { PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { Readable } from 'stream';
import { Metadata, MetadataInit, TriggerResponse } from '#self/delegate/request_response';
import { NoslatedDelegateService } from '#self/delegate';
import { PrefixedLogger } from '#self/lib/loggers';
import { DataFlowController } from './data_flow_controller';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Host } from '#self/lib/rpc/host';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { kMemoryLimit } from '#self/control_plane/constants';
import { performance } from 'perf_hooks';
import { ContainerStatusReport, kDefaultRequestId } from '#self/lib/constants';
import { DataPlaneHost } from './data_plane_host';

export enum RequestQueueStatus {
  PASS_THROUGH = 0,
  QUEUEING = 1
}

enum CredentialStatus {
  PENDING = 1,
  BOUND = 2
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

  /**
   * Constructor
   * @param {Readable|Buffer} inputStream The input stream.
   * @param {import('#self/delegate/request_response').Metadata|object} metadata The metadata.
   * @param {number} timeout The pending timeout.
   */
  constructor(
    inputStream: Readable | Buffer,
    public metadata: Metadata,
    timeout: number
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
    }, timeout);
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
   * @type {Promise<import('#self/delegate/request_response').TriggerResponse>}
   */
  get promise(): Promise<TriggerResponse> {
    return this.deferred.promise;
  }

  /**
   * Resolve the `promise`.
   * @type {(ret: import('#self/delegate/request_response').TriggerResponse) => void}
   */
  get resolve(): (ret: TriggerResponse) => void {
    return this.deferred.resolve;
  }

  /**
   * Reject the `promise`.
   * @type {(err: Error) => void}
   */
  get reject(): (err: Error) => void {
    return this.deferred.reject;
  }
}

// TODO: Reverse control with WorkerBroker.
export class Worker extends EventEmitter {
  activeRequestCount: number;
  logger: PrefixedLogger;
  trafficOff: boolean;

  /**
   * Constructor
   * @param {WorkerBroker} broker The parent worker broker object.
   * @param {NoslatedDelegateService} delegate The noslated delegate object.
   * @param {string} name The worker's name.
   * @param {string} credential The worker's credential.
   * @param {number} maxActivateRequests Max activate request count for this worker.
   */
  constructor(public broker: WorkerBroker, public delegate: NoslatedDelegateService, public name: string, public credential: string, public maxActivateRequests: number, public disposable: boolean) {
    super();
    this.activeRequestCount = 0;
    this.logger = new PrefixedLogger('worker', this.name);

    // + if `trafficOff` is `false`, then traffic may in;
    // + if `trafficOff` is `true`, then traffic won't in;
    this.trafficOff = false;
  }

  /**
   * Close this worker's traffic.
   * @return {Promise<boolean>} Whether the traffic really closed successfully.
   */
  async closeTraffic() {
    this.trafficOff = true;

    if (this.activeRequestCount <= 0) {
      return Promise.resolve(true);
    }

    const { promise, resolve } = utils.createDeferred();
    const downToZero: (...args: any[]) => void = () => {
      resolve(true);
    };

    this.once('downToZero', downToZero);

    return promise;
  }

  /**
   * Pipe input stream to worker process and get response.
   * @param {Readable|Buffer} inputStream The input stream.
   * @param {import('#self/delegate/request_response').Metadata|object} metadata The metadata object.
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The response.
   */
  async pipe(inputStream: Readable|Buffer|PendingRequest, metadata?: MetadataInit): Promise<TriggerResponse> {
    let waitMs = 0;

    let requestId = metadata?.requestId;

    if (inputStream instanceof PendingRequest) {
      metadata = inputStream.metadata;
      requestId = metadata.requestId;
      waitMs = Date.now() - inputStream.startEpoch;
      inputStream = inputStream.input;
    }

    requestId = requestId ?? kDefaultRequestId;

    this.activeRequestCount++;
    this.logger.info(`[${requestId}] Event dispatched, activeRequestCount: ${this.activeRequestCount}, wait: ${waitMs}ms.`);

    let ret;
    try {
      ret = await this.delegate.trigger(this.credential, 'invoke', inputStream, metadata || { requestId });
    } finally {
      this.activeRequestCount--;
      if (this.activeRequestCount === 0) {
        this.emit('downToZero');
      }

      this.continueConsumeQueue();
    }

    return ret;
  }

  continueConsumeQueue() {
    if (this.disposable) return;
    if (this.trafficOff) return;

    if (this.activeRequestCount < this.maxActivateRequests) {
      this.broker.tryConsumeQueue(this);
    }
  }
}

interface BrokerOptions {
  inspect?: boolean;
}

interface PendingCredentials {
  credential: string;
  name: string;
}

/**
 * A container that brokers same function's workers.
 */
export class WorkerBroker extends Base {
  profileManager: FunctionProfileManager;
  delegate: NoslatedDelegateService;
  host: DataPlaneHost;
  config: Config;
  logger: PrefixedLogger;
  requestQueue: PendingRequest[];
  requestQueueStatus: RequestQueueStatus;
  workers: Worker[];
  pendingCredentials: PendingCredentials[];
  credentialStatusMap: Map<string, CredentialStatus>;
  tokenBucket: TokenBucket | undefined = undefined;

  /**
   * TODO(chengzhong.wcz): dependency review;
   * @param {import('./data_flow_controller').DataFlowController} dataFlowController The data flow controller object.
   * @param {string} name The serverless function name.
   * @param {{ inspect?: boolean }} options The broker's options.
   */
  constructor(public dataFlowController: DataFlowController, public name: string, public options: BrokerOptions = {}) {
    super();

    this.profileManager = dataFlowController.profileManager;
    this.delegate = dataFlowController.delegate;
    this.host = dataFlowController.host;
    this.config = dataFlowController.config;

    this.logger = new PrefixedLogger('worker broker', `${name}${options.inspect ? ':inspect' : ''}`);
    /**
     * @type {PendingRequest[]}
     */
    this.requestQueue = [];
    this.requestQueueStatus = RequestQueueStatus.PASS_THROUGH;

    /**
     * @type {Worker[]}
     */
    this.workers = [];
    /**
     * @type {{ credential: string, name: string }[]}
     */
    this.pendingCredentials = [];

    /**
     * @type {Map<string, CredentialStatus>}
     */
    this.credentialStatusMap = new Map();

    const rateLimit = this.rateLimit;
    if (rateLimit) {
      this.tokenBucket = new TokenBucket(this.rateLimit as TokenBucketConfig);
    }
  }

  /**
   * Get worker via worker name and credential.
   * @param {string} name The worker's name.
   * @param {string} credential The worker's credential.
   * @return {Worker|string|null} The worker object or the pending credential.
   */
  getWorker(name: string, credential: string) {
    for (const worker of this.workers) {
      if (worker.name === name && worker.credential === credential) {
        return worker;
      }
    }

    const idx = _.findIndex(this.pendingCredentials, ['credential', credential]);

    if (idx !== undefined) {
      return credential;
    }

    return null;
  }

  /**
   * Get worker via only credential.
   * @param {string} credential The worker's credential.
   * @return {Worker|true|null} The worker object or the pending credential.
   */
  getWorkerByOnlyCredential(credential: string) {
    for (const worker of this.workers) {
      if (worker.credential === credential) {
        return worker;
      }
    }

    const idx = _.findIndex(this.pendingCredentials, ['credential', credential]);

    if (idx !== undefined) {
      return true;
    }

    return null;
  }

  /**
   * Remove a worker via credential.
   * @param {string} credential The worker's credential.
   */
  removeWorker(credential: string) {
    this.pendingCredentials = this.pendingCredentials.filter(c => credential !== c.credential);
    this.workers = this.workers.filter(w => w.credential !== credential);
    this.credentialStatusMap.delete(credential);
  }

  /**
   * Try consume the pending request queue.
   * @param {Worker} notThatBusyWorker The idled (not that busy) worker.
   */
  tryConsumeQueue(notThatBusyWorker: Worker) {
    if (notThatBusyWorker.trafficOff) return;

    while (this.requestQueue.length && notThatBusyWorker.maxActivateRequests > notThatBusyWorker.activeRequestCount) {
      if (notThatBusyWorker.trafficOff) break;

      const request: PendingRequest | undefined = this.requestQueue.shift();

      if (!request) continue;

      if (!request.available) continue;

      request.stopTimer();

      notThatBusyWorker.pipe(request, undefined).then(ret => {
        request.resolve(ret);
      }).catch(err => {
        request.reject(err);
      }).finally(() => {
        if (this.disposable) {
          this.afterDisposableInvoke(notThatBusyWorker, request.metadata.requestId);
        }
      });

      this.dataFlowController.queuedRequestDurationHistogram.record(Date.now() - request.startEpoch, {
        [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
      });

      // disposable 只消费一个请求
      if (this.disposable) break;
    }

    if (!this.requestQueue.length) {
      this.requestQueueStatus = RequestQueueStatus.PASS_THROUGH;
    }
  }

  async afterDisposableInvoke(worker: Worker, requestId?: string) {
    this.removeWorker(worker.credential);
    await worker.closeTraffic();
    // 同步 RequestDrained
    await this.host.broadcastContainerStatusReport({
      functionName: this.name,
      isInspector: this.options.inspect === true,
      name: worker.name,
      event: ContainerStatusReport.RequestDrained,
      requestId
    });
  }

  /**
   * Get the pending credential.
   * @param {string} credential The worker credential.
   * @return {{ credential: string, name: string }|false} The pending credential or false if not exists.
   */
  isCredentialPending(credential: string) {
    for (const c of this.pendingCredentials) {
      if (c.credential === credential) {
        return c;
      }
    }

    return false;
  }

  /**
   * Register credential to this broker.
   * @param {string} name The worker's name.
   * @param {string} credential The worker's credential.
   */
  registerCredential(name: string, credential: string) {
    if (this.isCredentialPending(credential)) {
      throw new Error(
        `Credential ${credential} already exists in ${this.name}.`);
    }
    this.pendingCredentials.push({ credential, name });
    this.credentialStatusMap.set(credential, CredentialStatus.PENDING);
  }

  get disposable() {
    const profile = this.profileManager.get(this.name);

    if (!profile) {
      return false;
    }

    return profile.worker?.disposable || false;
  }

  /**
   * Max activate requests count per worker of this broker.
   * @type {number}
   */
  get maxActivateRequests() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return this.config.worker.maxActivateRequests;
    }

    if (this.disposable) {
      return 1;
    }

    return profile.worker?.maxActivateRequests || this.config.worker.maxActivateRequests;
  }

  /**
   * replica count limit of this broker.
   * @type {number}
   */
  get replicaCountLimit() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return this.config.worker.replicaCountLimit;
    }

    return profile.worker?.replicaCountLimit || this.config.worker.replicaCountLimit;
  }

  /**
   * memory limit per worker of this broker.
   * @type {number}
   */
  get memoryLimit() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      // /lib/json/spec.template.json
      return kMemoryLimit;
    }

    return profile.resourceLimit?.memory || kMemoryLimit;
  }

  /**
   * Reservation count of this broker.
   * @type {number}
   */
  get reservationCount() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return this.config.worker.reservationCountPerFunction;
    }

    if (this.disposable) {
      return 0;
    }

    return profile.worker?.reservationCount || this.config.worker.reservationCountPerFunction;
  }

  /**
   * Rate limit of this broker.
   * @type {any}
   */
  get rateLimit() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return null;
    }

    return profile.rateLimit;
  }

  get profile() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      throw new Error(
        `Function '${this.name}' is no more existing in profile manager.`);
    }
    return profile;
  }

  get namespace() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return null;
    }

    return profile.namespace;
  }

  /**
   * Bind a worker to this broker and initialize.
   * @param {string} credential The worker's credential.
   * @return {Promise<void>} The result.
   */
  async bindWorker(credential: string) {
    if (!this.credentialStatusMap.has(credential)) {
      this.logger.error(`No credential ${credential} bound to the broker.`);
      return;
    }

    const c = this.isCredentialPending(credential);
    if (!c) {
      throw new Error(
        `Credential ${credential} has not registered in ${this.name} yet.`);
    }

    const status = this.credentialStatusMap.get(credential);
    if (status !== CredentialStatus.PENDING) {
      this.logger.error(`Duplicated worker with credential ${credential}`);
      return;
    }

    this.pendingCredentials = this.pendingCredentials.filter(c => {
      return c.credential !== credential;
    });

    const { profile } = this;
    const worker = new Worker(
      this,
      this.delegate,
      c.name,
      c.credential,
      this.maxActivateRequests,
      this.disposable
    );

    try {
      const now = performance.now();
      await this.delegate.trigger(credential, 'init', null, {
        timeout: profile.worker?.initializationTimeout !== undefined ?
          profile.worker.initializationTimeout :
          this.config.worker.defaultInitializerTimeout,
      });
      this.logger.info('worker(%s) initialization cost: %sms.', credential, performance.now() - now);
      // 同步 Container 状态
      await (this.host as any).broadcastContainerStatusReport({
        functionName: this.name,
        isInspector: this.options.inspect === true,
        name: worker.name,
        event: ContainerStatusReport.ContainerInstalled
      });
    } catch (e: any) {
      this.logger.debug('Unexpected error on invokeing initializer', e.message);
      this.delegate.resetPeer(credential);
      throw e;
    }

    this.workers.push(worker);

    this.credentialStatusMap.set(credential, CredentialStatus.BOUND);

    this.tryConsumeQueue(worker);
  }

  /**
   * Get an available worker for balancer.
   * @return {Worker|null} The worker object or null to indicates no available worker.
   */
  getAvailableWorker() {
    if (!this.workers.length) return null;

    const worker = _.maxBy(this.workers.filter(w => !w.trafficOff), w => (w.maxActivateRequests - w.activeRequestCount));
    if (worker && worker.maxActivateRequests > worker.activeRequestCount) {
      return worker;
    }

    return null;
  }

  /**
   * Create a pending request to the queue.
   * @param {Readable|Buffer} input The input stream to be temporarily stored.
   * @param {import('#self/delegate/request_response').Metadata|object} metadata The metadata.
   * @return {PendingRequest} The created pending request.
   */
  createPendingRequest(input: Readable|Buffer, metadata: Metadata) {
    this.logger.info('create pending request(%s).', metadata.requestId);
    const request = new PendingRequest(input, metadata, metadata.timeout);
    this.dataFlowController.queuedRequestCounter.add(1, {
      [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
    });

    // TODO(kaidi.zkd): 统一计时器定时批量处理超时
    request.once('timeout', () => {
      this.logger.debug('A request wait timeout.');
      this.requestQueue = this.requestQueue.filter(r => r !== request);
      request.reject(new Error(`Timeout for waiting worker in ${metadata.timeout}ms, request(${request.requestId}).`));
      this.dataFlowController.queuedRequestDurationHistogram.record(Date.now() - request.startEpoch, {
        [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
      });
    });

    // broadcast that there's no enough container
    this.host.broadcastRequestQueueing(this, this.dataFlowController.currentWorkersInformation, request.requestId);
    return request;
  }

  /**
   *Try `startUp` fastfail. If it needs fastfail, throw error.
   */
  #tryStartUpFastFail() {
    const { profile } = this;
    if (profile?.worker?.fastFailRequestsOnStarting !== true) return;

    (this.host as any).broadcastRequestQueueing(this, this.dataFlowController.currentWorkersInformation);
    throw new Error(`No available worker process for ${this.name} now.`);
  }

  /**
   * Fast fail all pendings due to start error
   * @param {root.noslated.data.IStartWorkerFastFailRequest} startWorkerFastFailRequest The fast fail request.
   */
  fastFailAllPendingsDueToStartError(startWorkerFastFailRequest: root.noslated.data.IStartWorkerFastFailRequest) {
    const { requestQueue } = this;
    this.requestQueue = [];
    const err = new Error(startWorkerFastFailRequest.displayMessage as string);
    for (const pendingRequest of requestQueue) {
      pendingRequest.stopTimer();
      pendingRequest.reject(err);
      this.dataFlowController.queuedRequestDurationHistogram.record(Date.now() - pendingRequest.startEpoch, {
        [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
      });
    }
  }

  /**
   * Invoke to an available worker if possible and response.
   * @param {Reaable|Buffer} inputStream The input stream.
   * @param {import('#self/delegate/request_response').Metadata|object} metadata The metadata.
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The response.
   */
  async invoke(inputStream: Readable|Buffer, metadata: Metadata) {
    await this.ready();
    const acquiredToken = this.tokenBucket?.acquire() ?? true;
    if (!acquiredToken) {
      throw new RpcError('rate limit exceeded', { code: RpcStatus.RESOURCE_EXHAUSTED });
    }

    switch (this.requestQueueStatus) {
      case RequestQueueStatus.QUEUEING: {
        const request = this.createPendingRequest(inputStream, metadata);
        this.requestQueue.push(request);
        return request.promise;
      }

      case RequestQueueStatus.PASS_THROUGH: {
        const worker = this.getAvailableWorker();
        if (!worker) {
          this.#tryStartUpFastFail();

          this.requestQueueStatus = RequestQueueStatus.QUEUEING;
          const request = this.createPendingRequest(inputStream, metadata);
          this.requestQueue.push(request);
          return request.promise;
        }

        let output;

        try {
          output = await worker.pipe(inputStream, metadata);
        } finally {
          if (this.disposable) {
            this.afterDisposableInvoke(worker, metadata.requestId);
          }
        }

        return output;
      }

      default: {
        throw new Error(`Request queue status ${this.requestQueueStatus} unreachable.`);
      }
    }
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
