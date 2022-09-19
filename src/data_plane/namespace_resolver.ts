import { BeaconHost, Namespace } from '#self/delegate/namespace';
import { IMidwayLogger, createLogger } from '@midwayjs/logger';
import type { DataFlowController } from './data_flow_controller';
import type { WorkerBroker } from './worker_broker';

export class DataPlaneBeaconHost implements BeaconHost {
  logger: IMidwayLogger;

  constructor(logger?: IMidwayLogger) {
    // TODO: use OTEL Trace
    this.logger = logger || createLogger('beaconLogger', {
      enableFile: false,
      enableError: false,
    });
  }

  async sendBeacon(type: string, metadata: any, body: Uint8Array): Promise<void> {
    if (type !== 'trace') {
      return;
    }

    this.logger.write(body);
  }
}

class DataPlaneNamespace extends Namespace {
  constructor(public beaconHost: DataPlaneBeaconHost) {
    super();
  }
}

export class NamespaceResolver {
  beaconHost = new DataPlaneBeaconHost();
  /** @type {WeakMap<object, Map>} Map resource id to credentials */
  #brokersMap = new WeakMap<WorkerBroker, DataPlaneNamespace>();
  /**
   * TODO: 暂时由 worker 配置注册，后续由全局 namespace 机制管理
   */
  #sharedNamespace = new Map<string, DataPlaneNamespace>();
  #default = new DataPlaneNamespace(this.beaconHost);
  dataFlowController: DataFlowController;

  constructor(dataFlowController: DataFlowController) {
    this.dataFlowController = dataFlowController;
  }

  register(namespace: string) {
    if (!this.#sharedNamespace.has(namespace)) {
      const ns = new DataPlaneNamespace(this.beaconHost);
      this.#sharedNamespace.set(namespace, ns);
    }
  }

  unregister(namespace: string) {
    this.#sharedNamespace.delete(namespace);
  }

  existingShardedNamespaceKeys(): Set<string> {
    return new Set(this.#sharedNamespace.keys());
  }

  resolve(credential: string) {
    const broker = this.dataFlowController.credentialBrokerMap.get(credential);
    if (broker == null) {
      return this.#default;
    }

    if (broker.namespace) {
      return this.#sharedNamespace.get(broker.namespace)!;
    }

    let namespace = this.#brokersMap.get(broker);

    if (namespace == null) {
      namespace = new DataPlaneNamespace(this.beaconHost);
      this.#brokersMap.set(broker, namespace);
    }

    return namespace;
  }
}
