import EventEmitter from 'events';
import {
  connectivityState,
  ServiceClientConstructor,
  status,
  ChannelInterface,
  ClientDuplexStream,
  credentials,
  getClientChannel
} from '@grpc/grpc-js';
import { descriptor, RequestType, HostEvents, delegateClientMethods, kDefaultChannelOptions } from './util';
import { Any } from './any';
import { BackoffCounter, createDeferred, Deferred, raceEvent } from '../util';
import { ServiceClient } from '@grpc/grpc-js/build/src/make-client';
import * as root from '#self/proto/root';
import { IHostClient } from '#self/lib/interfaces/guest';
import { loggers } from '../loggers';

const logger = loggers.get('guest');

const kStreamDisconnectedCode = [ status.CANCELLED, status.UNAVAILABLE ];

class StreamClient extends EventEmitter {
  #streamClient: ClientDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk> | null = null;
  #ready = false;
  #closed = false;

  #backoffCounter: BackoffCounter;
  #backoffTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private hostClient: IHostClient, initialBackoff: number, maxReconnectBackoff: number) {
    super();
    this.#backoffCounter = new BackoffCounter(initialBackoff, maxReconnectBackoff);
    this.#createClient();
  }

  #createClient() {
    try {
      this.#streamClient = this.hostClient.connect();
    } catch (err) {
      this.#onConnectionUnstable(err);
      return;
    }
    this.#streamClient?.on('data', chunk => {
      for (const item of chunk.events) {
        const any = Any.unpack(item.data);
        this.#onEvent(item.name, any.object, any);
        if (item.name === HostEvents.LIVENESS && !this.#ready) {
          this.#onConnectionStable();
        }
      }
    });
    this.#streamClient?.on('error', error => {
      this.#onConnectionUnstable(error);
    });
    this.#streamClient?.on('end', () => {
      this.#onConnectionUnstable()
    });
  }

  #onEvent(name: string, event: any, message: Any) {
    this.emit('event', name, event, message);
  }

  #onConnectionStable() {
    this.#ready = true;
    this.#backoffCounter.reset();
  }

  #onConnectionUnstable(error?: any) {
    this.#streamClient?.end();
    this.#streamClient = null;
    this.#ready = false;
    if (error && !kStreamDisconnectedCode.includes(error.code)) {
      logger.debug('stream client connection error', error);
    }

    if (this.#closed) {
      return;
    }

    // backoff.
    const nextBackoff = this.#backoffCounter.next();
    this.#backoffTimer = setTimeout(() => {
      this.#createClient();
    }, nextBackoff);
  }

  destroy() {
    // clear backoff.
    if (this.#backoffTimer) {
      clearTimeout(this.#backoffTimer);
    }
    this.#streamClient?.end();
    this.#closed = true;
  }

  write(request: root.noslated.IRequest) {
    this.#streamClient?.write(request);
  }
}

export class Guest extends EventEmitter {
  static events = {
    CONNECTIVITY_STATE_CHANGED: 'connectivity-state-changed',
  };
  static connectivityState = connectivityState;

  #address;
  #channel: ChannelInterface;
  #hostClient: IHostClient;
  #clients: Map<ServiceClientConstructor, ServiceClient> = new Map();
  /** @type {grpc.ClientDuplexStream} */
  #streamClient: StreamClient | null;
  #streamClientInitTimeoutMs;

  #initialReconnectBackoffMs;
  #maxReconnectBackoffMs;

  /** @type {Set<string>} */
  #subscribedEvents: Set<string> = new Set();
  #started = false;

  constructor(address: string, options?: GuestOptions) {
    super();
    this.#address = address;

    this.#initialReconnectBackoffMs = options?.initialReconnectBackoffMs ?? 100;
    this.#maxReconnectBackoffMs = options?.maxReconnectBackoffMs ?? 5_000;

    this.#hostClient = new (descriptor as any).noslated.Host(this.#address, credentials.createInsecure(), {
      'grpc.enable_http_proxy': 0,
      'grpc.initial_reconnect_backoff_ms': this.#initialReconnectBackoffMs,
      'grpc.max_reconnect_backoff_ms': this.#maxReconnectBackoffMs,
      ...kDefaultChannelOptions,
    });
    this.#channel = getClientChannel(this.#hostClient);
    this.#streamClientInitTimeoutMs = options?.streamClientInitTimeoutMs ?? 2_000;
    this.#streamClient = null;
  }

  #onConnectionStateChanged = (oldState: connectivityState, err?: Error) => {
    const newState = this.#channel.getConnectivityState(false);
    if (newState === connectivityState.SHUTDOWN) {
      return;
    }
    if (err) {
      this.#onError(err);
      return;
    }

    this.#channel.getConnectivityState(/** exit idle */true);

    let watchDeadline;
    if ([ connectivityState.READY ].includes(newState)) {
      watchDeadline = Infinity;
    } else {
      /** typically, this won't time out. the state will go error and reconnect. */
      watchDeadline = Date.now() + 10_000;
    }
    this.#channel.watchConnectivityState(
      newState,
      watchDeadline,
      err => this.#onConnectionStateChanged(newState, err as Error));

    const stable = newState === connectivityState.READY;
    const unstable = newState === connectivityState.IDLE && oldState === connectivityState.READY;
    /** only emit state changed event when significant state changes */
    if (this.#started && (unstable || stable)) {
      this.emit(Guest.events.CONNECTIVITY_STATE_CHANGED, newState);
    }
    if (stable) {
      this.#onConnectionStable();
    } else if (unstable) {
      this.#onConnectionUnstable()
    }
  }

  #onConnectionUnstable = () => {
    this.#streamClient?.destroy();
    this.#streamClient = null;
  }

  #onConnectionStable = () => {
    if (this.#streamClient == null) {
      this.#streamClient = new StreamClient(this.#hostClient, this.#initialReconnectBackoffMs, this.#maxReconnectBackoffMs);
      this.#streamClient.on('event', (event: string, ...args: any[]) => {
        this.emit(event, ...args);
      });
    }
    for (const eventName of this.#subscribedEvents) {
      this.#streamClient?.write({
        type: RequestType.SUBSCRIBE,
        subscription: { eventName, subscribe: true },
      });
    }
  }

  /**
   * Wait for arbitrary stream client ready.
   * Stream client may be replace when the connection is unstable.
   */
  async #waitForStreamClientReady(timeout: number) {
    const deferred = createDeferred<void>();
    const initTimeout = setTimeout(() => {
      const err = new Error('Guest stream client failed to receive liveness signal in time.');
      err.code = status.DEADLINE_EXCEEDED;
      deferred.reject(err);
    }, timeout);

    const { promise, off } = raceEvent(this, [ HostEvents.LIVENESS, 'error' ]);
    const raceFuture = promise.then(([event, args]) => {
      if (event !== HostEvents.LIVENESS) {
        throw args[0];
      }
    });

    return Promise.race([deferred.promise, raceFuture])
      .finally(() => {
        clearTimeout(initTimeout);
        off();
      });
  }

  #onError = (e: Error) => {
    if (this.#started) {
      console.log('guest on error', this.#started, e);
      this.emit('error', e);
    }
    this.close();
  }

  get address() {
    return this.#address;
  }

  subscribe(event: string, callback?: GuestEventCallback<unknown>) {
    this.#subscribedEvents.add(event);
    if (callback) {
      this.on(event, callback);
    }
    if (this.#streamClient == null) {
      return;
    }
    this.#streamClient.write({
      type: RequestType.SUBSCRIBE,
      subscription: { eventName: event, subscribe: true },
    });
  }

  unsubscribe(event: string) {
    this.#subscribedEvents.delete(event);
    if (this.#streamClient == null) {
      return;
    }
    this.#streamClient.write({
      type: RequestType.SUBSCRIBE,
      subscription: { eventName: event, subscribe: false },
    });
  }

  livenessCheckpoint() {
    this.#streamClient?.write({
      type: RequestType.LIVENESS_PROBE,
      liveness: { timestamp: Date.now() },
    });
  }

  addService(clientDescriptor: ServiceClientConstructor) {
    const client = new clientDescriptor(this.#address, credentials.createInsecure(), {
      channelOverride: this.#channel,
    });
    this.#clients.set(clientDescriptor, client);
    delegateClientMethods(this, client, clientDescriptor.service);
    return client;
  }

  /**
   * Add services to guest
   */
  addServices(descriptors: ServiceClientConstructor[]) {
    return descriptors.map(descriptor => this.addService(descriptor));
  }

  get host() {
    return this.#hostClient;
  }

  getClient(clientDescriptor: ServiceClientConstructor) {
    return this.#clients.get(clientDescriptor);
  }

  getConnectivityState() {
    return this.#channel.getConnectivityState(false);
  }

  /**
   * Connect to the host immediately. If the connection was failed, the
   * returning promise will be rejected.
   */
  async start(options?: GuestStartOptions) {
    await new Promise<void>((resolve, reject) => {
      this.#hostClient.waitForReady(/* deadline */ Date.now() + (options?.connectionTimeout ?? 10_000), error => {
        if (error) {
          return reject(error);
        }
        resolve();
      });
    });

    this.#channel.watchConnectivityState(
      connectivityState.READY,
      Infinity,
      () => this.#onConnectionStateChanged(connectivityState.READY)
    );

    this.#onConnectionStable();
    await this.#waitForStreamClientReady(this.#streamClientInitTimeoutMs);
    this.#started = true;
  }

  async close() {
    this.#started = false;
    if (this.#streamClient) {
      // suppress any cancellation errors during shutdown;
      this.#streamClient.removeAllListeners('error');
      this.#streamClient.on('error', () => {});
      this.#streamClient.destroy();
    }
    this.#hostClient.close();
  }
}

interface GuestOptions {
  initialReconnectBackoffMs?: number;
  maxReconnectBackoffMs?: number;
  streamClientInitTimeoutMs?: number;
}

type GuestEventCallback<T> = (msg: T, packet: Any<T>) => unknown;

interface GuestStartOptions {
  connectionTimeout: number;
}
