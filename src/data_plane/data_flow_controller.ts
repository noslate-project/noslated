import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { NoslatedDelegateService } from '#self/delegate/index';
import { BaseOf } from '#self/lib/sdk_base';
import { FunctionConfigBag } from './function_config';
import { FunctionProfileManager, Mode } from '#self/lib/function_profile';
import { getCurrentPlaneId, setDifference } from '#self/lib/util';
import { InspectorAgent } from '#self/diagnostics/inspector_agent';
import { RpcError, RpcStatus } from '#self/lib/rpc/error';
import { SystemCircuitBreaker } from './circuit_breaker';
import { Worker, WorkerBroker } from './worker_broker';
import { ServiceProfileItem, ServiceSelector } from './service_selector';
import { getMeter } from '#self/lib/telemetry/otel';
import { DataPlaneMetrics, PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { WorkerTelemetry } from './worker_telemetry';
import { NamespaceResolver } from './namespace_resolver';
import { Host } from '#self/lib/rpc/host';
import { Config } from '#self/config';
import { Meter } from '@opentelemetry/api';
import * as root from '#self/proto/root';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { Readable } from 'stream';
import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { ContainerStatusReport } from '#self/lib/constants';

const logger = require('#self/lib/logger').get('data flow controller');

/**
 * Data flow controller
 */
export class DataFlowController extends BaseOf(EventEmitter) {
  #invokeCounter;
  #invokeDurationHistogram;

  queuedRequestCounter;
  queuedRequestDurationHistogram;

  meter: Meter;
  delegateSockPath: string;
  profileManager: FunctionProfileManager;
  namespaceResolver: NamespaceResolver;
  delegate: NoslatedDelegateService;
  inspectorAgent: InspectorAgent | null = null;
  functionConfigBag: FunctionConfigBag;
  brokers: Map<string, WorkerBroker>;
  credentialBrokerMap: Map<string, WorkerBroker>;
  circuitBreaker: SystemCircuitBreaker;
  serviceSelector: ServiceSelector;

  workerTrafficStatsBroadcastInterval: NodeJS.Timer | null;
  orphanBrokerCleanInterval: NodeJS.Timer | null;

  telemetry: WorkerTelemetry;

  constructor(public host: Host, public config: Config) {
    super();

    this.meter = getMeter();
    this.#invokeCounter = this.meter.createCounter(DataPlaneMetrics.INVOKE_COUNT, {});
    this.#invokeDurationHistogram = this.meter.createHistogram(DataPlaneMetrics.INVOKE_DURATION, {});

    this.queuedRequestCounter = this.meter.createCounter(DataPlaneMetrics.QUEUED_REQUEST_COUNT, {});
    this.queuedRequestDurationHistogram = this.meter.createHistogram(DataPlaneMetrics.QUEUED_REQUEST_DURATION, {});

    const delegateSockPath = this.delegateSockPath = path.join(
      this.config.dirs.noslatedSock,
      `dlgt-${getCurrentPlaneId()}.sock`);

    fs.mkdirSync(path.dirname(delegateSockPath), { recursive: true });

    this.profileManager = new FunctionProfileManager(config);

    this.namespaceResolver = new NamespaceResolver(this);
    this.delegate = new NoslatedDelegateService(delegateSockPath, {
      meter: this.meter,
      namespaceResolver: this.namespaceResolver,
    });

    if (process.env.DISABLE_INSPECTOR !== 'true') {
      this.inspectorAgent = new InspectorAgent(this.delegate);
    }

    // TODO: there is no way to cleanup unused configs.
    this.functionConfigBag = new FunctionConfigBag();
    /**
     * @type Map<string, WorkerBroker>
     */
    this.brokers = new Map();
    /**
     * @type Map<string, WorkerBroker>
     */
    this.credentialBrokerMap = new Map();
    this.circuitBreaker = new SystemCircuitBreaker(this, this.config.systemCircuitBreaker);
    this.serviceSelector = new ServiceSelector();

    this.delegate.on('bind', this.#onBind);
    this.delegate.on('disconnect', this.#onDisconnect);

    this.workerTrafficStatsBroadcastInterval = null;
    this.orphanBrokerCleanInterval = null;

    this.telemetry = new WorkerTelemetry(this.meter, this.delegate, this);
  }

  getResourceUsages() {
    const credentials = Array.from(this.credentialBrokerMap.entries());
    return credentials.map(([ credential, broker ]) => {
      const usage = this.delegate.getResourceUsage(credential);
      if (usage == null) {
        return null;
      }
      return {
        workerName: broker.name,
        functionName: broker.profile.name,
        ...usage,
      };
    }).filter(it => it != null);
  }

  /**
   * Close certain workers' traffic in one broker
   * @param {root.noslated.data.ICapacityReductionBroker} broker The capacity reduction broker object in Protobuf.
   * @param {WorkerBroker} realBroker The real broker object with methods.
   * @param {root.noslated.data.ICapacityReductionBroker} toBeClosed The capacity reduction broker object in Protobuf with closed workers.
   * @return {Promise<void>} The result.
   */
  async closeCertainWorkersTrafficInOneBroker(
    broker: root.noslated.data.ICapacityReductionBroker,
    realBroker: WorkerBroker,
    toBeClosed: root.noslated.data.ICapacityReductionBroker
  ) {
    const close = async (realWorker: Worker, worker: root.noslated.data.ICapacityReductionWorker, broker: WorkerBroker) => {
      const closed = await realWorker.closeTraffic();

      if (closed) {
        await (this.host as any).broadcastContainerStatusReport({
          functionName: broker.name,
          isInspector: broker.options.inspect === true,
          name: realWorker.name,
          event: ContainerStatusReport.RequestDrained
        });

        toBeClosed?.workers?.push(worker);
      }
    };

    const promises = [];
    for (const worker of (broker?.workers || [])) {
      const realWorker = realBroker.getWorker(worker.name as string, worker.credential as string);
      if (!realWorker) continue;
      if (typeof realWorker === 'string') {
        // extracted from queueing credentials
        toBeClosed.workers?.push(worker);
        continue;
      }

      // real close traffic
      promises.push(close(realWorker, worker, realBroker));
    }

    const ret = await Promise.allSettled(promises);
    for (const result of ret) {
      if (result.status === 'rejected') {
        logger.warn('Failed to close traffic.', result.reason);
      }
    }
  }

  /**
   * Close traffic via workers
   * @param {root.noslated.data.ICapacityReductionBroker[]} workersInfo The brokers including workers information.
   * @return {Promise<root.noslated.data.ICapacityReductionBroker[]>} The brokers including workers that traffic closed.
   */
  async closeTraffic(workersInfo: root.noslated.data.ICapacityReductionBroker[]) {
    const closed = [];
    const promises = [];

    for (const broker of workersInfo) {
      const realBroker = this.getBroker(broker.functionName as string, { inspect: broker.inspector } as RegisterWorkerOptions);
      if (!realBroker) continue;
      const closedBroker = { ...broker };
      closedBroker.workers = [];
      closed.push(closedBroker);
      promises.push(this.closeCertainWorkersTrafficInOneBroker(broker, realBroker, closedBroker));
    }

    const ret = await Promise.allSettled(promises);

    for (const result of ret) {
      if (result.status === 'rejected') {
        logger.warn('Failed to close traffic.', result.reason);
      }
    }

    return closed;
  }

  /**
   * Function that be called when a worker disconnected on delegate.
   * @param {string} credential The worker's credential.
   * @return {Promise<void>} The result.
   */
  #onDisconnect = async (credential: string) => {
    const broker = this.credentialBrokerMap.get(credential);
    if (!broker) {
      logger.warn(`${credential} already disconnected.`);
      return;
    }

    const worker = broker.getWorkerByOnlyCredential(credential);
    const tag = worker ? ((worker as Worker).name || `{${credential}}`) : `{${credential}}`;
    logger.info(`Worker ${tag} disconnected from ${broker.name}.`);

    broker.removeWorker(credential);
    this.credentialBrokerMap.delete(credential);

    if (worker instanceof Worker) {
      await (this.host as any).broadcastContainerStatusReport({
        functionName: broker.name,
        name: worker.name,
        event: ContainerStatusReport.ContainerDisconnected,
        isInspector: broker.options.inspect === true
      });
    }
  }

  /**
   * Function that be called when a worker attached to delegate.
   * @param {string} credential The worker's credential
   * @return {Promise<void>} The result.
   */
  #onBind = async (credential: string) => {
    const broker = this.credentialBrokerMap.get(credential);
    if (!broker) {
      logger.error(`No broker maintains credential ${credential}.`);
      return;
    }

    // if a worker channel is attached, we should find the matched broker,
    // and create a Worker object to it.

    try {
      await broker.bindWorker(credential);
    } catch (e) {
      logger.error('Failed to attach worker:', e);
      this.emit('attachError', e);
      return;
    }

    const worker = broker.getWorkerByOnlyCredential(credential);
    const tag = worker ? ((worker as Worker).name || `{${credential}}`) : `{${credential}}`;

    logger.info(`Worker ${tag} for ${broker.name} attached.`);
  }

  /**
   * Register worker's credential to delegate for waiting connecting.
   * @param {string} funcName The serverless function's name.
   * @param {string} name The worker's name.
   * @param {string} credential The worker's credential.
   * @param {{ inspect?: boolean }} [options] The register options.
   */
  registerWorkerCredential(funcName: any, name: string, credential: string, options: RegisterWorkerOptions = {}) {
    const broker = this.getBroker(funcName, options);
    broker?.registerCredential(name, credential);
    this.credentialBrokerMap.set(credential, broker as WorkerBroker);
    this.delegate.register(credential);
  }

  /**
   * Get or create a broker with a certain name.
   * @param {string} name The serverless function's name.
   * @param {{ inspect?: boolean }} [options] The broker's options.
   * @return {WorkerBroker} The created or got broker.
   */
  getBroker(name: string, options: RegisterWorkerOptions = {}) {
    let key = name;
    if (options.inspect) {
      key += '$$inspect';
    } else {
      key += '$$noinspect';
    }

    if (this.brokers.has(key)) {
      return this.brokers.get(key);
    }

    const broker = new WorkerBroker(this, name, options);
    this.brokers.set(key, broker);
    return broker;
  }

  /**
   * Current workers' stats information.
   * @type {root.noslated.data.IBrokerStats[]} The brokers with workers' stats.
   */
  get currentWorkersInformation(): root.noslated.data.IBrokerStats[] {
    return [ ...this.brokers.values() ].map(broker => ({
      functionName: broker.name,
      inspector: broker.options.inspect === true,
      disposable: broker.disposable,
      workers: broker.workers.map(worker => ({
        name: worker.name,
        maxActivateRequests: worker.maxActivateRequests,
        activeRequestCount: worker.activeRequestCount,
      })),
    }));
  }

  /**
   * Broadcast worker's traffic stats to clients.
   * @return {Promise<void>} The result.
   */
  broadcastWorkerTrafficStats = async () => {
    await (this.host as any).broadcastWorkerTrafficStats({
      brokers: this.currentWorkersInformation,
    });
  };

  /**
   * Clean orphan brokers (brokers that no more exists in function profiles)
   * @return {Promise<void>} The result.
   */
  cleanOrphanBrokers = async () => {
    const cleanedKeys = [];
    for (const [ key, broker ] of this.brokers.entries()) {
      if (!this.profileManager.get(broker.name) && !broker.workers.length) {
        cleanedKeys.push(key);
        broker.close();
      }
    }

    for (const key of cleanedKeys) this.brokers.delete(key);
  }

  /**
   * Init function (override)
   */
  async _init() {
    await this.delegate.start();
    if (this.inspectorAgent) await this.inspectorAgent.start();

    this.workerTrafficStatsBroadcastInterval = setInterval(this.broadcastWorkerTrafficStats, 1000);
    this.orphanBrokerCleanInterval = setInterval(this.cleanOrphanBrokers, 1000);

    this.circuitBreaker.start();

    logger.info(`delegate listened at ${this.delegateSockPath}.`);
  }

  /**
   * Close function (override)
   */
  async _close() {
    if (this.workerTrafficStatsBroadcastInterval) {
      clearInterval(this.workerTrafficStatsBroadcastInterval);
      this.workerTrafficStatsBroadcastInterval = null;
    }

    if (this.orphanBrokerCleanInterval) {
      clearInterval(this.orphanBrokerCleanInterval);
      this.orphanBrokerCleanInterval = null;
    }

    this.circuitBreaker.close();
    Array.from(this.brokers.values()).map(it => it.close());

    if (this.inspectorAgent) await this.inspectorAgent.close();
    this.delegate.close();

    fs.rmSync(this.delegateSockPath, { force: true });
    logger.info('closed.');
  }

  /**
   * Set function profile
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile[]} profile The function profile
   * @param {'IMMEDIATELY' | 'WAIT'} mode the mode
   */
  async setFunctionProfile(profile: RawFunctionProfile[], mode: Mode = 'IMMEDIATELY') {
    logger.info('Setting function profile');
    // 获取前后 namespace 差异
    const { toAdd, toRemove } = this.compareSharedNamespaces(profile);

    // 新增的 namespace 提前创建
    toAdd.forEach((ns) => {
      this.namespaceResolver.register(ns);
    });

    await this.profileManager.set(profile, mode);

    // 过期的 namespace 延后移除
    toRemove.forEach((ns) => {
      this.namespaceResolver.unregister(ns);
    });
  }

  compareSharedNamespaces(profile: RawFunctionProfile[]) {
    const existingNamespaces = this.namespaceResolver.existingShardedNamespaceKeys();
    const newNamespaces = new Set<string>();

    profile.forEach((p) => {
      if (p.namespace) {
        newNamespaces.add(p.namespace);
      }
    });

    const toRemove = setDifference<string>(existingNamespaces, newNamespaces);
    const toAdd = setDifference<string>(newNamespaces, existingNamespaces);

    return { toAdd, toRemove };
  }

  async setServiceProfiles(profiles: ServiceProfileItem[]) {
    this.serviceSelector = new ServiceSelector(profiles);
  }

  /**
   * Set a serverless function to whether use inspector or not.
   * @param {string} name The function name.
   * @param {boolean} use Whether use inspector or not.
   */
  useInspector(name: string, use: boolean) {
    this.functionConfigBag?.get(name)?.setUseInspector(!!use);
  }

  /**
   * Invoke to a certain function.
   * @param {string} name The function's name.
   * @param {Buffer|Readable} inputStream The input stream.
   * @param {import('#self/delegate/request_response').Metadata} metadata The metadata.
   * @param {{serviceName?: string}} context -
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The invoke response.
   */
  async invoke(name: string , inputStream: Buffer | Readable, metadata: Metadata, { serviceName = '' }: InvokeContext = {}): Promise<TriggerResponse> {
    if (this.circuitBreaker.opened) {
      throw new RpcError('System circuit breaker opened.', { code: RpcStatus.FAILED_PRECONDITION });
    }
    const funcProfile = this.profileManager.get(name);

    if (funcProfile == null) {
      throw new RpcError(`No function named ${name} registered in this node.`, { code: RpcStatus.NOT_FOUND });
    }

    const startTime = Date.now();
    try {
      const broker = this.getBroker(name, {
        inspect: this.functionConfigBag?.get(name)?.getUseInspector(),
      });

      if (broker) {
        return broker.invoke(inputStream, metadata);
      } else {
        throw new RpcError(`No broker to invoke function [${name}] in this node.`, { code: RpcStatus.NOT_FOUND });
      }
    } finally {
      const endTime = Date.now();
      this.#invokeCounter.add(1, {
        [PlaneMetricAttributes.FUNCTION_NAME]: name,
        [PlaneMetricAttributes.SERVICE_NAME]: serviceName,
      });
      this.#invokeDurationHistogram.record(endTime - startTime, {
        [PlaneMetricAttributes.FUNCTION_NAME]: name,
        [PlaneMetricAttributes.SERVICE_NAME]: serviceName,
      });
    }
  }

  async invokeService(name: string, inputStream: Buffer | Readable, metadata: Metadata) {
    if (this.circuitBreaker.opened) {
      throw new RpcError('System circuit breaker opened.', { code: RpcStatus.FAILED_PRECONDITION });
    }

    const labels = this.serviceSelector.select(name);
    if (labels == null) {
      throw new RpcError('Service not found.', { code: RpcStatus.NOT_FOUND });
    }

    return this.invoke(labels.functionName, inputStream, metadata, { serviceName: name });
  }
}

interface RegisterWorkerOptions {
  inspect?: boolean
}

interface InvokeContext {
  serviceName?: string;
}
