import { systemClock } from './clock';
import { createDeferred } from './util';

export class Event {
  // TODO: default global clock.
  timeStamp = systemClock.now();
  constructor(public readonly type: string) {}
}

interface EventConstructor<T extends Event> {
  type: string;
  new (...args: any[]): T;
}

export interface Observer<T> {
  next(event: T): void | Promise<void>;
}

export class EventBus {
  private _map: Map<string, EventChannel>;

  constructor(events: EventConstructor<Event>[]) {
    this._map = new Map();
    for (const eventConstructor of events) {
      this._map.set(
        eventConstructor.type,
        new EventChannel(eventConstructor.type)
      );
    }
  }

  private _getChannel(name: string) {
    const channel = this._map.get(name);
    if (channel == null) {
      throw new Error(`Event '${name}' is not recognizable`);
    }
    return channel;
  }

  get events() {
    return Array.from(this._map.keys());
  }

  getChannel(name: string): EventChannel {
    return this._getChannel(name);
  }

  async publish(event: Event) {
    const channel = this._getChannel(event.type);
    return channel.publish(event);
  }

  subscribe<T extends Event>(eve: EventConstructor<T>, observer: Observer<T>) {
    const channel = this._getChannel(eve.type);
    channel.subscribe(observer);
  }

  unsubscribe<T extends Event>(
    eve: EventConstructor<T>,
    observer: Observer<Event>
  ) {
    const channel = this._getChannel(eve.type);
    channel.unsubscribe(observer);
  }

  once<T extends Event>(eve: EventConstructor<T>): Promise<T> {
    const deferred = createDeferred<T>();
    const observer: Observer<T> = {
      next: event => {
        deferred.resolve(event);
        this.unsubscribe(eve, observer);
      },
    };
    this.subscribe(eve, observer);

    return deferred.promise;
  }
}

export class EventChannel {
  observers: Observer<Event>[] = [];

  constructor(public name: string) {}

  async publish(event: Event) {
    for (let idx = 0; idx < this.observers.length; idx++) {
      const observer = this.observers[idx];
      await observer.next(event);
    }
  }

  subscribe(observer: Observer<Event>) {
    this.observers.push(observer);
  }

  unsubscribe(observer: Observer<Event>) {
    const idx = this.observers.indexOf(observer);
    if (idx >= 0) {
      this.observers.splice(idx, 1);
    }
  }
}
