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
import { raceEvent } from '../util';
import { ServiceClient } from '@grpc/grpc-js/build/src/make-client';
import * as root from '#self/proto/root';
import { IHostClient } from '#self/lib/interfaces/guest';

const kStreamDisconnectedCode = [ status.CANCELLED, status.UNAVAILABLE ];

export class Guest extends EventEmitter {
  static events = {
    STREAM_CLIENT_ERROR: 'stream-client-error',
    CONNECTIVITY_STATE_CHANGED: 'connectivity-state-changed',
  };
  static connectivityState = connectivityState;

  #address;
  #channel: ChannelInterface;
  #hostClient: IHostClient;
  #clients: Map<ServiceClientConstructor, ServiceClient> = new Map();
  /** @type {grpc.ClientDuplexStream} */
  #streamClient: ClientDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk> | null;
  #streamClientInitTimeoutMs;

  /** @type {Set<string>} */
  #subscribedEvents: Set<string> = new Set();
  #started = false;

  constructor(address: string, options?: GuestOptions) {
    super();
    this.#address = address;
    this.#hostClient = new (descriptor as any).noslated.Host(this.#address, credentials.createInsecure(), {
      ...kDefaultChannelOptions,
      'grpc.enable_http_proxy': 0,
      'grpc.initial_reconnect_backoff_ms': options?.initialReconnectBackoffMs ?? 100,
      'grpc.max_reconnect_backoff_ms': options?.maxReconnectBackoffMs ?? 10_000,
    });
    this.#channel = getClientChannel(this.#hostClient);
    this.#streamClientInitTimeoutMs = options?.streamClientInitTimeoutMs ?? 2_000;
    this.#streamClient = null;
  }

  #streamClientPreamble = () => {
    if (this.#streamClient == null) {
      this.#streamClient = this.#hostClient.connect();
      let initTimeout: NodeJS.Timeout | undefined = setTimeout(() => {
        const err = new Error('Guest stream client failed to receive liveness signal in time.');
        err.code = status.DEADLINE_EXCEEDED;
        this.#streamClient?.destroy(err);
        initTimeout = undefined;
      }, this.#streamClientInitTimeoutMs);
      this.#streamClient?.on('data', chunk => {
        for (const item of chunk.events) {
          const any = Any.unpack(item.data);
          this.emit(item.name, any.object, any);
          if (item.name === HostEvents.LIVENESS && initTimeout) {
            clearTimeout(initTimeout);
            initTimeout = undefined;
          }
        }
      });
      this.#streamClient?.on('error', error => {
        clearTimeout(initTimeout);
        initTimeout = undefined;
        if (kStreamDisconnectedCode.includes(error.code as status)) {
          this.emit(Guest.events.STREAM_CLIENT_ERROR, error);
          return;
        }
        this.#onError(error);
      });
      this.#streamClient?.on('end', () => {
        clearTimeout(initTimeout);
        initTimeout = undefined;
        this.#streamClient = null;
      });
    }
  }

  #onChannelUnstable = (oldState: connectivityState, err?: Error) => {
    const newState = this.#channel.getConnectivityState(false);
    if (newState === connectivityState.SHUTDOWN) {
      return;
    }
    if (err) {
      this.#onError(err);
      return;
    }

    this.#channel.getConnectivityState(/** exit idle */true);

    /** only emit state changed event when significant state changes */
    if (this.#started && ((newState === connectivityState.IDLE && oldState === connectivityState.READY) ||
      newState === connectivityState.READY)) {
      this.emit(Guest.events.CONNECTIVITY_STATE_CHANGED, newState);
    }

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
      err => this.#onChannelUnstable(newState, err as Error));

    if (newState === connectivityState.READY) {
      this.#onConnectionStable();
    }
  }

  #onConnectionStable = () => {
    this.#streamClientPreamble();
    for (const eventName of this.#subscribedEvents) {
      this.#streamClient?.write({
        type: RequestType.SUBSCRIBE,
        subscription: { eventName, subscribe: true },
      });
    }
  }

  #onError = (e: Error) => {
    this.close();
    this.emit('error', e);
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
    this.#streamClientPreamble();
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
      () => this.#onChannelUnstable(connectivityState.READY)
    );

    this.#onConnectionStable();
    const [ event, args ] = await raceEvent(this, [ HostEvents.LIVENESS, Guest.events.STREAM_CLIENT_ERROR, 'error' ]);
    if (event !== HostEvents.LIVENESS) {
      throw args[0];
    }
    this.#started = true;
  }

  async close() {
    if (this.#streamClient) {
      // suppress any cancellation errors during shutdown;
      this.#streamClient.removeAllListeners('error');
      this.#streamClient.on('error', () => {});
      this.#streamClient.end();
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