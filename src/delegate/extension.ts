import { NamespaceResolver } from './namespace';
import { loggers } from '#self/lib/loggers';

const logger = loggers.get('extension');

export class Extension {
  #namespaceResolver: NamespaceResolver;
  constructor(namespaceResolver: NamespaceResolver) {
    this.#namespaceResolver = namespaceResolver;
  }

  kv(credentials: string, operation: string, metadata: any, body: Uint8Array) {
    const kvStorage = this.#namespaceResolver.resolve(credentials).kvStorage;
    const namespace = `${metadata.namespace}`;
    const key = `${metadata.key}`;
    let data;
    switch (operation) {
      case 'open': {
        kvStorage.openStore(namespace, !!metadata.lru);
        break;
      }
      case 'get': {
        data = kvStorage.get(namespace, key);
        break;
      }
      case 'set': {
        kvStorage.set(namespace, key, body);
        break;
      }
      case 'delete': {
        kvStorage.delete(namespace, key);
        break;
      }
      case 'list': {
        data = Buffer.from(JSON.stringify(kvStorage.list(namespace)));
        break;
      }
    }
    return { status: 200, data };
  }

  async beacon(
    credentials: string,
    operation: string,
    metadata: any,
    body: Uint8Array
  ) {
    const beaconHost = this.#namespaceResolver.resolve(credentials).beaconHost;
    try {
      await beaconHost.sendBeacon(metadata.type, metadata, body);
    } catch (err) {
      logger.error('unexpected error on send beacon', err);
    }

    return { status: 200, data: Buffer.alloc(0) };
  }
}
