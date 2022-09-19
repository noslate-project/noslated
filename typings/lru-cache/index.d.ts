// Type definitions for lru-cache 7
// Project: https://github.com/isaacs/node-lru-cache
// Definitions by: Bart van der Schoor <https://github.com/Bartvds>
//                 BendingBender <https://github.com/BendingBender>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped
// TypeScript Version: 2.3

declare module 'lru-cache' {
  declare class LRUCache<K, V> {
    constructor(options?: LRUCache.Options<K, V>);

    readonly max: number;
    readonly maxSize: number;
    readonly sizeCalculation?: (value: V, key: K) => number | undefined;
    readonly dispose?: (this: LRUCache<K, V>, key: K, value: V) => void | undefined;
    readonly disposeAfter?: (this: LRUCache<K, V>, key: K, value: V) => void | undefined;
    readonly noDisposeOnSet: boolean;
    readonly ttl: number;
    readonly noUpdateTTL: boolean;
    readonly ttlResolution: number;
    readonly ttlAutopurge: boolean;
    readonly allowStale: boolean;
    readonly updateAgeOnGet: boolean;

    /**
     * Will update the "recently used"-ness of the key. They do what you think.
     * `maxAge` is optional and overrides the cache `maxAge` option if provided.
     */
    set(key: K, value: V, options?: LRUCache.SetOptions<K, V>): boolean;

    /**
     * Will update the "recently used"-ness of the key. They do what you think.
     * `maxAge` is optional and overrides the cache `maxAge` option if provided.
     *
     * If the key is not found, will return `undefined`.
     */
    get(key: K, options?: LRUCache.GetOptions): V | undefined;

    /**
     * Returns the key value (or `undefined` if not found) without updating
     * the "recently used"-ness of the key.
     *
     * (If you find yourself using this a lot, you might be using the wrong
     * sort of data structure, but there are some use cases where it's handy.)
     */
    peek(key: K, options?: LRUCache.PeekOptions): V | undefined;

    /**
     * Check if a key is in the cache, without updating the recent-ness
     * or deleting it for being stale.
     */
    has(key: K): boolean;

    /**
     * Deletes a key out of the cache.
     */
    delete(key: K): void;

    /**
     * Clear the cache entirely, throwing away all values.
     */
    clear(): void;

    /**
     * Return a generator yielding the keys in the cache.
     */
    keys(): IterableIterator<K>;

    /**
     * Return a generator yielding the values in the cache.
     */
    values(): IterableIterator<V>;

    /**
     * Return a generator yielding [key, value] pairs.
     */
    entries(): IterableIterator<[K, V]>;

    /**
     *
     */
    find(predicate: (value: V, key: K, cache: LRUCache<K, V>) => boolean, options?: LRUCache.GetOptions): V | undefined;

    /**
     * Return an array of [key, entry] objects which can be passed to cache.load()
     */
    dump(): [K, V][];

    /**
     * Reset the cache and load in the items in entries in the order listed.
     * Note that the shape of the resulting cache may be different if the same
     * options are not used in both caches.
     */
    load(entries: [K, V][]): void;

    /**
     * Manually iterates over the entire cache proactively pruning old entries.
     */
    purgeStale(): void;

    /**
     * Just like `Array.prototype.forEach`. Iterates over all the keys in the cache,
     * in order of recent-ness. (Ie, more recently used items are iterated over first.)
     */
    forEach<T = this>(callbackFn: (this: T, value: V, key: K, cache: this) => void, thisArg?: T): void;

    /**
     * The same as `cache.forEach(...)` but items are iterated over in reverse order.
     * (ie, less recently used items are iterated over first.)
     */
    rforEach<T = this>(callbackFn: (this: T, value: V, key: K, cache: this) => void, thisArg?: T): void;

    /**
     * Evict the least recently used item, returning its value.
     *
     * Returns `undefined` if cache is empty
     */
    pop(): V;
  }

  declare namespace LRUCache {
    interface PeekOptions {
      allowStale?: boolean | undefined;
    }

    interface GetOptions {
      updateAgeOnGet?: boolean | undefined;
      allowStale?: boolean | undefined;
    }

    interface SetOptions<K, V> {
      size?: number | undefined;
      sizeCalculation?: (value: V, key: K) => number | undefined;
      ttl?: number | undefined;
      noDisposeOnSet?: boolean | undefined;
    }

    type DisposalReason = 'evict' | 'set' | 'delete';

    interface Options<K, V> {
      /**
       * The maximum number (or size) of items that remain in the cache
       * (assuming no TTL pruning or explicit deletions). Note that fewer items
       * may be stored if size calculation is used, and `maxSize` is exceeded.
       * This must be a positive finite intger.
       *
       * This option is required, and must be a positive integer.
       */
      max: number;

      /**
       * Set to a positive integer to track the sizes of items added to the
       * cache, and automatically evict items in order to stay below this size.
       * Note that this may result in fewer than max items being stored.
       *
       * Optional, must be a positive integer if provided. Required if other
       * size tracking features are used.
       */
      maxSize?: number | undefined;

      /**
       * Function used to calculate the size of stored items. If you're storing
       * strings or buffers, then you probably want to do something like
       * `n => n.length`. The item is passed as the first argument, and the key
       * is passed as the second argument.
       *
       * This may be overridden by passing an options object to `cache.set()`.
       *
       * Requires maxSize to be set.
       */
      sizeCalculation?: (value: V, key: K) => number | undefined;

      /**
       * Function that is called on items when they are dropped from the cache,
       * as `this.dispose(value, key, reason)`.
       */
      dispose?: (this: LRUCache<K, V>, value: V, key: K, reason: DisposalReason) => void | undefined;

      /**
       * The same as `dispose`, but called after the entry is completely
       * removed and the cache is once again in a clean state.
       *
       * It is safe to add an item right back into the cache at this point.
       * However, note that it is very easy to inadvertently create infinite
       * recursion in this way.
       */
      disposeAfter?: (this: LRUCache<K, V>, value: V, key: K) => void | undefined;

      /**
       * Set to true to suppress calling the `dispose()` function if the entry
       * key is still accessible within the cache.
       *
       * This may be overridden by passing an options object to `cache.set()`.
       *
       * Boolean, default false. Only relevant if `dispose` or `disposeAfter`
       * options are set.
       */
      noDisposeOnSet?: boolean | undefined;

      /**
       * Max time to live for items before they are considered stale. Note that
       * stale items are NOT preemptively removed by default, and MAY live in
       * the cache, contributing to its LRU max, long after they have expired.
       *
       * Also, as this cache is optimized for LRU/MRU operations, some of the
       * staleness/TTL checks will reduce performance, as they will incur
       * overhead by deleting from Map objects rather than simply throwing old
       * Map objects away.
       *
       * This is not primarily a TTL cache, and does not make strong TTL
       * guarantees. There is no pre-emptive pruning of expired items, but you
       * may set a TTL on the cache, and it will treat expired items as missing
       * when they are fetched, and delete them.
       *
       * Optional, but must be a positive integer in ms if specified.
       *
       * This may be overridden by passing an options object to `cache.set()`.
       */
      ttl?: number | undefined;

      /**
       * Boolean flag to tell the cache to not update the TTL when setting a
       * new value for an existing key (ie, when updating a value rather than
       * inserting a new value). Note that the TTL value is always set (if
       * provided) when adding a new entry into the cache.
       *
       * This may be passed as an option to cache.set().
       *
       * Boolean, default false.
       */
      noUpdateTTL?: boolean | undefined;

      /**
       * Minimum amount of time in ms in which to check for staleness. Defaults
       * to 1, which means that the current time is checked at most once per
       * millisecond.
       *
       * Set to 0 to check the current time every time staleness is tested.
       *
       * Note that setting this to a higher value will improve performance
       * somewhat while using ttl tracking, albeit at the expense of keeping
       * stale items around a bit longer than intended.
       */
      ttlResolution?: number | undefined;

      /**
       * Preemptively remove stale items from the cache.
       *
       * Note that this may significantly degrade performance, especially if
       * the cache is storing a large number of items. It is almost always
       * best to just leave the stale items in the cache, and let them fall
       * out as new items are added.
       *
       * Note that this means that allowStale is a bit pointless, as stale
       * items will be deleted almost as soon as they expire.
       *
       * Use with caution!
       *
       * Boolean, default false
       */
      ttlAutopurge?: boolean | undefined;

      /**
       * By default, if you set `ttl`, it'll only delete stale items from the
       * cache when you `get(key)`. That is, it's not preemptively pruning
       * items.
       *
       * If you set `allowStale:true`, it'll return the stale value as well as
       * deleting it. If you don't set this, then it'll return undefined when
       * you try to get a stale entry.
       *
       * Note that when a stale entry is fetched, even if it is returned due to
       * `allowStale` being set, it is removed from the cache immediately. You
       * can immediately put it back in the cache if you wish, thus resetting
       * the TTL.
       *
       * This may be overridden by passing an options object to `cache.get()`.
       * The `cache.has()` method will always return false for stale items.
       *
       * Boolean, default false, only relevant if ttl is set.
       */
      allowStale?: boolean | undefined;

      /**
       * When using time-expiring entries with ttl, setting this to true will
       * make each item's age reset to 0 whenever it is retrieved from cache
       * with get(), causing it to not expire. (It can still fall out of cache
       * based on recency of use, of course.)
       *
       * This may be overridden by passing an options object to cache.get().
       *
       * Boolean, default false, only relevant if ttl is set.
       */
      updateAgeOnGet?: boolean | undefined;
    }
  }

  export = LRUCache;
}

