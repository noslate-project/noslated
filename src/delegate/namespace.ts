import { KvStorage } from './kv_storage';
import { ResourceStub } from './resource';

interface NamespaceResolver {
  resolve(credential: string): Namespace;
}

class DefaultNamespaceResolver implements NamespaceResolver {
  /** Map resource id to credentials */
  #default = new Namespace();
  resolve(_credential: string) {
    return this.#default;
  }
}

interface BeaconHost {
  sendBeacon(type: string, metadata: any, body: Uint8Array): Promise<void>;
}

class NoopBeaconHost implements BeaconHost {
  sendBeacon(type: string, metadata: any, body: Uint8Array): Promise<void> {
    return Promise.resolve();
  }
}

class Namespace {
  resources = new Map<string, ResourceStub>();
  kvStorage = new KvStorage();
  beaconHost = new NoopBeaconHost();
}

export {
  NamespaceResolver,
  DefaultNamespaceResolver,
  Namespace,
  BeaconHost,
  NoopBeaconHost,
};
