import EventEmitter from 'events';
import _ from 'lodash';
import * as utils from '#self/lib/util';
import { TokenBucket, TokenBucketConfig } from './token_bucket';
import { RpcError, RpcStatus } from '#self/lib/rpc/error';
import { Base } from '#self/lib/sdk_base';
import { PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { Readable } from 'stream';
import {
  Metadata,
  MetadataInit,
  TriggerResponse,
} from '#self/delegate/request_response';
import { NoslatedDelegateService } from '#self/delegate';
import { PrefixedLogger } from '#self/lib/loggers';
import { DataFlowController } from './data_flow_controller';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { performance } from 'perf_hooks';
import { WorkerStatusReport, kDefaultRequestId } from '#self/lib/constants';
import { DataPlaneHost } from './data_plane_host';
import { List } from '#self/lib/list';

enum RequestQueueStatus {
  PASS_THROUGH = 0,
  QUEUEING = 1,
}

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
    return this.deferred.resolve;
  }

  /**
   * Reject the `promise`.
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

  constructor(
    public broker: WorkerBroker,
    public delegate: NoslatedDelegateService,
    public name: string,
    public credential: string,
    public maxActivateRequests: number,
    public disposable: boolean
  ) {
    super();
    this.activeRequestCount = 0;
    this.logger = new PrefixedLogger('worker', this.name);

    // + if `trafficOff` is `false`, then traffic may in;
    // + if `trafficOff` is `true`, then traffic won't in;
    this.trafficOff = false;
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
  async pipe(
    inputStream: Readable | Buffer | PendingRequest,
    metadata?: MetadataInit
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

    this.activeRequestCount++;
    this.logger.info(
      `[${requestId}] Event dispatched, activeRequestCount: ${this.activeRequestCount}, wait: ${waitMs}ms.`
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
      return ret;
    } catch (e: unknown) {
      if (e instanceof Error) {
        e['queueing'] = waitMs;
        e['workerName'] = this.name;
      }

      throw e;
    } finally {
      this.activeRequestCount--;
      if (this.activeRequestCount === 0) {
        this.emit('downToZero');
      }

      this.continueConsumeQueue();
    }
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

interface CredentialItem {
  status: CredentialStatus;
  name: string;
}

/**
 * A container that brokers same function's workers.
 */
export class WorkerBroker extends Base {
  private profileManager: FunctionProfileManager;
  private delegate: NoslatedDelegateService;
  private host: DataPlaneHost;
  private config: Config;
  private logger: PrefixedLogger;
  requestQueue: List<PendingRequest>;
  private requestQueueStatus: RequestQueueStatus;
  workers: Worker[];
  private credentialStatusMap: Map<string, CredentialItem>;
  private tokenBucket: TokenBucket | undefined = undefined;

  /**
   * TODO(chengzhong.wcz): dependency review;
   */
  constructor(
    public dataFlowController: DataFlowController,
    public name: string,
    public options: BrokerOptions = {}
  ) {
    super();

    this.profileManager = dataFlowController.profileManager;
    this.delegate = dataFlowController.delegate;
    this.host = dataFlowController.host;
    this.config = dataFlowController.config;

    this.logger = new PrefixedLogger(
      'worker broker',
      `${name}${options.inspect ? ':inspect' : ''}`
    );
    this.requestQueue = new List();
    this.requestQueueStatus = RequestQueueStatus.PASS_THROUGH;

    this.workers = [];
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

    if (
      this.credentialStatusMap.get(credential)?.status ===
      CredentialStatus.PENDING
    ) {
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

    if (
      this.credentialStatusMap.get(credential)?.status ===
      CredentialStatus.PENDING
    ) {
      return true;
    }

    return null;
  }

  /**
   * Remove a worker via credential.
   * @param {string} credential The worker's credential.
   */
  removeWorker(credential: string) {
    this.workers = this.workers.filter(w => w.credential !== credential);
    this.credentialStatusMap.delete(credential);
  }

  /**
   * Try consume the pending request queue.
   * @param {Worker} notThatBusyWorker The idled (not that busy) worker.
   */
  tryConsumeQueue(notThatBusyWorker: Worker) {
    if (notThatBusyWorker.trafficOff) return;

    while (
      this.requestQueue.length &&
      notThatBusyWorker.maxActivateRequests >
        notThatBusyWorker.activeRequestCount
    ) {
      if (notThatBusyWorker.trafficOff) break;

      const request = this.requestQueue.shift();

      if (!request) continue;

      if (!request.available) continue;

      request.stopTimer();

      let response: TriggerResponse;

      notThatBusyWorker
        .pipe(request, undefined)
        .then(ret => {
          response = ret;
          request.resolve(ret);
        })
        .catch(err => {
          request.reject(err);
        })
        .finally(() => {
          if (this.disposable) {
            this.afterDisposableInvoke(
              notThatBusyWorker,
              response,
              request.metadata.requestId
            );
          }
        });

      this.dataFlowController.queuedRequestDurationHistogram.record(
        Date.now() - request.startEpoch,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: this.name,
        }
      );

      // disposable 只消费一个请求
      if (this.disposable) break;
    }

    if (!this.requestQueue.length) {
      this.requestQueueStatus = RequestQueueStatus.PASS_THROUGH;
    }
  }

  private async afterDisposableInvoke(
    worker: Worker,
    response: TriggerResponse | undefined,
    requestId?: string
  ) {
    await worker.closeTraffic();

    if (response) {
      // wait response data sent
      await response.finish();
    }

    // 同步 RequestDrained
    await this.host.broadcastContainerStatusReport({
      functionName: this.name,
      isInspector: this.options.inspect === true,
      name: worker.name,
      event: WorkerStatusReport.RequestDrained,
      requestId,
    });
  }

  /**
   * Get the pending credential.
   * @param {string} credential The worker credential.
   * @return {{ credential: string, name: string }|false} The pending credential or false if not exists.
   */
  private isCredentialPending(credential: string) {
    return (
      this.credentialStatusMap.get(credential)?.status ===
      CredentialStatus.PENDING
    );
  }

  /**
   * Register credential to this broker.
   * @param {string} name The worker's name.
   * @param {string} credential The worker's credential.
   */
  registerCredential(name: string, credential: string) {
    if (this.isCredentialPending(credential)) {
      throw new Error(
        `Credential ${credential} already exists in ${this.name}.`
      );
    }
    this.credentialStatusMap.set(credential, {
      status: CredentialStatus.PENDING,
      name,
    });
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
  private get maxActivateRequests() {
    const profile = this.profileManager.get(this.name);
    if (!profile) {
      return this.config.worker.maxActivateRequests;
    }

    if (this.disposable) {
      return 1;
    }

    return (
      profile.worker?.maxActivateRequests ||
      this.config.worker.maxActivateRequests
    );
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
        `Function '${this.name}' is no more existing in profile manager.`
      );
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
        `Credential ${credential} has not registered in ${this.name} yet.`
      );
    }

    const item = this.credentialStatusMap.get(credential);
    if (item == null || item.status !== CredentialStatus.PENDING) {
      this.logger.error(`Duplicated worker with credential ${credential}`);
      return;
    }

    const { profile } = this;
    const worker = new Worker(
      this,
      this.delegate,
      item.name,
      credential,
      this.maxActivateRequests,
      this.disposable
    );

    try {
      const now = performance.now();
      await this.delegate.trigger(credential, 'init', null, {
        deadline:
          (profile.worker?.initializationTimeout !== undefined
            ? profile.worker.initializationTimeout
            : this.config.worker.defaultInitializerTimeout) + Date.now(),
      });
      this.logger.info(
        'worker(%s) initialization cost: %sms.',
        item.name,
        performance.now() - now
      );
      // 同步 Container 状态
      await (this.host as any).broadcastContainerStatusReport({
        functionName: this.name,
        isInspector: this.options.inspect === true,
        name: worker.name,
        event: WorkerStatusReport.ContainerInstalled,
      });
    } catch (e: any) {
      this.logger.debug('Unexpected error on invokeing initializer', e.message);
      this.delegate.resetPeer(credential);
      throw e;
    }

    this.workers.push(worker);

    const tag = worker
      ? (worker as Worker).name || `{${credential}}`
      : `{${credential}}`;

    this.logger.info(
      `Worker ${tag} for ${this.name} attached, draining request queue.`
    );

    this.credentialStatusMap.set(credential, {
      status: CredentialStatus.BOUND,
      name: item.name,
    });

    this.tryConsumeQueue(worker);
  }

  /**
   * Get an available worker for balancer.
   * @return {Worker|null} The worker object or null to indicates no available worker.
   */
  getAvailableWorker() {
    if (!this.workers.length) return null;

    const worker = _.maxBy(
      this.workers.filter(w => !w.trafficOff),
      w => w.maxActivateRequests - w.activeRequestCount
    );
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
  private createPendingRequest(input: Readable | Buffer, metadata: Metadata) {
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
        new Error(
          `Waiting for worker has timed out at ${metadata.deadline}, request(${request.requestId}).`
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
    this.host.broadcastRequestQueueing(
      this,
      this.dataFlowController.currentWorkersInformation,
      request.requestId
    );
    return request;
  }

  /**
   *Try `startUp` fastfail. If it needs fastfail, throw error.
   */
  #tryStartUpFastFail() {
    const { profile } = this;
    if (profile?.worker?.fastFailRequestsOnStarting !== true) return;

    (this.host as any).broadcastRequestQueueing(
      this,
      this.dataFlowController.currentWorkersInformation
    );
    throw new Error(`No available worker process for ${this.name} now.`);
  }

  /**
   * Fast fail all pendings due to start error
   * @param {root.noslated.data.IStartWorkerFastFailRequest} startWorkerFastFailRequest The fast fail request.
   */
  fastFailAllPendingsDueToStartError(
    startWorkerFastFailRequest: root.noslated.data.IStartWorkerFastFailRequest
  ) {
    const requestQueue = this.requestQueue;
    this.requestQueue = new List();
    const err = new Error(startWorkerFastFailRequest.displayMessage!);
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
  async invoke(inputStream: Readable | Buffer, metadata: Metadata) {
    await this.ready();
    const acquiredToken = this.tokenBucket?.acquire() ?? true;
    if (!acquiredToken) {
      throw new RpcError('rate limit exceeded', {
        code: RpcStatus.RESOURCE_EXHAUSTED,
      });
    }

    switch (this.requestQueueStatus) {
      case RequestQueueStatus.QUEUEING: {
        const request = this.createPendingRequest(inputStream, metadata);
        return request.promise;
      }

      case RequestQueueStatus.PASS_THROUGH: {
        const worker = this.getAvailableWorker();
        if (!worker) {
          this.#tryStartUpFastFail();

          this.requestQueueStatus = RequestQueueStatus.QUEUEING;
          const request = this.createPendingRequest(inputStream, metadata);
          return request.promise;
        }

        let response;

        try {
          response = await worker.pipe(inputStream, metadata);
        } finally {
          if (this.disposable) {
            this.afterDisposableInvoke(worker, response, metadata.requestId);
          }
        }

        return response;
      }

      default: {
        throw new Error(
          `Request queue status ${this.requestQueueStatus} unreachable.`
        );
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
