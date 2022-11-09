import { BeaconHost, Namespace, NoopBeaconHost } from '#self/delegate/namespace';
import type { DataFlowController } from './data_flow_controller';
import type { WorkerBroker } from './worker_broker';

class DataPlaneNamespace extends Namespace {
  constructor(public beaconHost: BeaconHost) {
    super();
  }
}

export class NamespaceResolver {
  beaconHost: BeaconHost;
  /** @type {WeakMap<object, Map>} Map resource id to credentials */
  #brokersMap = new WeakMap<WorkerBroker, DataPlaneNamespace>();
  /**
   * TODO: 暂时由 worker 配置注册，后续由全局 namespace 机制管理
   */
  #sharedNamespace = new Map<string, DataPlaneNamespace>();
  #default: Namespace;
  dataFlowController: DataFlowController;

  constructor(dataFlowController: DataFlowController) {
    this.dataFlowController = dataFlowController;

    const modPath = this.dataFlowController.config.dataPlane.beaconHostModulePath;
    if (modPath) {
      const BeaconHostClass = require(modPath);
      this.beaconHost = new BeaconHostClass()
    } else {
      this.beaconHost = new NoopBeaconHost();
    }
    this.#default = new DataPlaneNamespace(this.beaconHost);
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
