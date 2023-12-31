import { CapacityExceededError, ConflictError, NotFoundError } from './error';
import { config } from '#self/config';
import LRU from 'lru-cache';
import { LoggerFactory } from '#self/lib/logger_factory';

const logger = LoggerFactory.prefix('kv-storages');

const kPerNamespaceCapacity = config.delegate.kvStoragePerNamespaceCapacity;
const kPerNamespaceMaxSize = config.delegate.kvStoragePerNamespaceMaxSize;
const kPerNamespaceMaxByteLength =
  config.delegate.kvStoragePerNamespaceMaxByteLength;

export class KvStorage {
  size = 0;
  sink = new Map<string, LRU<string, Uint8Array>>();

  getStore(namespace: string) {
    const store = this.sink.get(namespace);
    if (store != null) {
      return store;
    }
    throw new NotFoundError('Store not found');
  }

  openStore(namespace: string, lru: boolean) {
    let store = this.sink.get(namespace);
    if (store != null) {
      if (lru !== (store.maxSize !== 0)) {
        throw new ConflictError('Storage configuration conflicts');
      }
      return store;
    }
    if (this.sink.size >= kPerNamespaceCapacity) {
      throw new CapacityExceededError('Namespace capacity exceeded');
    }
    store = new LRU({
      max: kPerNamespaceMaxSize,
      maxSize: lru ? kPerNamespaceMaxByteLength : 0,
      updateAgeOnGet: true,
      dispose: (value, key, reason) => {
        logger.info(
          'dispose key in kv-storage: namespace(%s), key(%s), reason(%s)',
          namespace,
          key,
          reason
        );
      },
    });
    this.sink.set(namespace, store);
    return store;
  }

  get(namespace: string, key: string) {
    const store = this.getStore(namespace);
    return store.get(key);
  }

  set(namespace: string, key: string, value: Uint8Array) {
    const store = this.getStore(namespace);
    const keyByteLength = Buffer.from(key).byteLength;
    const existingSize = store.has(key)
      ? store.get(key)!.byteLength + keyByteLength
      : 0;
    const entryByteLength = value.byteLength + keyByteLength;
    /** Check if the entry is larger than capacity */
    if (entryByteLength > kPerNamespaceMaxByteLength) {
      throw new CapacityExceededError('Namespace size limit exceeded.');
    }
    /** Check capacity when the store is not LRU */
    if (
      store.maxSize === 0 &&
      entryByteLength - existingSize + this.size >= kPerNamespaceMaxByteLength
    ) {
      throw new CapacityExceededError('Namespace size limit exceeded.');
    }
    this.size += entryByteLength - existingSize;
    store.set(key, value, {
      size: entryByteLength,
    });
  }

  delete(namespace: string, key: string) {
    const store = this.getStore(namespace);
    const existingSize = store.get(key)?.byteLength ?? 0;
    this.size -= existingSize;
    store.delete(key);
  }

  list(namespace: string) {
    const store = this.getStore(namespace);
    return Array.from(store.keys());
  }
}
