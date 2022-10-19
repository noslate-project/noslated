import EventEmitter from 'events';
import {
  Server,
  ServerDuplexStream,
  ServiceDefinition,
  UntypedServiceImplementation,
  ServerCredentials
} from '@grpc/grpc-js';
import { dirname } from 'path';
import { descriptor, RequestType, HostEvents, delegateServiceImplementations, kDefaultChannelOptions } from './util';
import { Any } from './any';
import * as root from '#self/proto/root';

const fs = require('fs').promises;

function mapGetOrDefault<KeyType, ValueType>(map: Map<KeyType, ValueType[]>, key: KeyType, defaults: ValueType[]) {
  let val = map.get(key);
  if (val == null) {
    map.set(key, defaults);
    val = defaults;
  }
  return val;
}

export class Host extends EventEmitter {
  static events = {
    NEW_CONNECTION: 'new-connection',
    DISCONNECTED: 'disconnected',
    NEW_SUBSCRIBER: 'new-subscriber',
  }

  #address: string;
  #server: Server;
  #subscriberMap: Map<string, ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>[]> = new Map();
  #callMap: WeakMap<ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>, { subscribedEvents: Set<string> }> = new WeakMap();
  #logger;

  constructor(address: string, logger = console) {
    super();
    this.#address = address;
    this.#logger = logger;
    this.#server = new Server(kDefaultChannelOptions);
    const Host = (descriptor as any).noslated.Host.service;
    this.#server.addService(Host, delegateServiceImplementations(Host, {
      connect: this.#onConnection,
    }, this.#onerror));
  }

  #onerror = (err: unknown) => {
    this.#logger.error('unexpected error on host', err);
  }

  #onConnection = (call: ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>) => {
    this.#callMap.set(call, {
      subscribedEvents: new Set(),
    });
    call.on('data', msg => {
      switch (msg.type) {
        case RequestType.SUBSCRIBE: {
          this.#subscribe(call, msg.subscription);
          break;
        }
        case RequestType.LIVENESS_PROBE: {
          this._livenessProbe(call);
          break;
        }
        default:
      }
    });
    call.on('end', () => {
      this.#onDisconnect(call);
    });
    this._livenessProbe(call);
    this.emit(Host.events.NEW_CONNECTION);
  }

  #onDisconnect = (call: ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>) => {
    const item = this.#callMap.get(call);

    if (!item) {
      return;
    }

    const { subscribedEvents } = item;

    for (const event of subscribedEvents.values()) {
      this.#removeSubscriber(event, call);
    }

    this.emit(Host.events.DISCONNECTED);
  }

  /**
   * subscribe true/false 代表是订阅还是取消订阅
   */
  #subscribe = (call: ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>, { eventName, subscribe }: root.noslated.ISubscriptionRequest) => {
    const item = this.#callMap.get(call);

    if (!item) {
      return;
    }

    const { subscribedEvents } = item;

    if (eventName == null || subscribe == null) {
      return;
    }

    if (subscribe) {
      if (subscribedEvents.has(eventName)) {
        return;
      }

      subscribedEvents.add(eventName);
      this.#addSubscriber(eventName, call);
    } else {
      if (!subscribedEvents.has(eventName)) {
        return;
      }
      subscribedEvents.delete(eventName);
      this.#removeSubscriber(eventName, call);
    }
  }

  #addSubscriber = (eventName: string, call: ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>) => {
    const subscribers = mapGetOrDefault(this.#subscriberMap, eventName, []);
    subscribers.push(call);

    this.emit(Host.events.NEW_SUBSCRIBER, eventName);
  }

  #removeSubscriber = (eventName: string, call: ServerDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>) => {
    const subscribers = mapGetOrDefault(this.#subscriberMap, eventName, []);
    const idx = subscribers.indexOf(call);
    if (idx >= 0) {
      subscribers.splice(idx, 1);
    }
  }

  _livenessProbe = (call: ServerDuplexStream<root.noslated.ILivenessProbeRequest, root.noslated.ISubscriptionChunk>) => {
    call.write({
      timestamp: Date.now(),
      events: [
        {
          name: HostEvents.LIVENESS,
          data: Any.pack<root.noslated.ILivenessProbeEventData>('noslated.LivenessProbeEventData', {
            timestamp: Date.now(),
            component_liveness: {
              key: 'host',
              value: 'ok',
            },
          }),
        },
      ],
    });
  }

  get address() {
    return this.#address;
  }

  getSubscribers(eventName: string) {
    return mapGetOrDefault(this.#subscriberMap, eventName, []);
  }

  broadcast<T>(eventName: string, typeUrl: string, msg: T) {
    const subscribers = mapGetOrDefault(this.#subscriberMap, eventName, []);
    for (const it of subscribers) {
      it.write({
        timestamp: Date.now(),
        events: [
          {
            name: eventName,
            data: Any.pack(typeUrl, msg),
          },
        ],
      });
    }
  }

  addService(serviceDefinition: ServiceDefinition, impl: UntypedServiceImplementation) {
    this.#server.addService(
      serviceDefinition,
      delegateServiceImplementations(serviceDefinition, impl, this.#onerror)
    );
  }

  async start(...args: any[]) {
    const { protocol, pathname } = new URL(this.#address);
    if (protocol === 'unix:') {
      await fs.unlink(pathname)
        .catch((e: Error) => {
          if (e.code === 'ENOENT') {
            return;
          }
          throw e;
        });
      await fs.mkdir(dirname(pathname), { recursive: true });
    }
    await new Promise<void>((resolve, reject) => {
      this.#server.bindAsync(this.#address, ServerCredentials.createInsecure(), error => {
        if (error) {
          return reject(error);
        }
        resolve();
      });
    });
    this.#server.start();
  }

  async close() {
    this.#server.forceShutdown();
  }
}
