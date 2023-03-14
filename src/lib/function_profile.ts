import { EventEmitter } from 'events';

import { LinkList } from './linklist';
import { Validator as JSONValidator } from 'jsonschema';
import loggers from './logger';
import * as utils from './util';
import SCHEMA_JSON from './json/function_profile_schema.json';
import SPEC_JSON from './json/spec.template.json';
import type {
  NodejsFunctionProfile,
  RawFunctionProfile,
  RawWithDefaultsFunctionProfile,
  AworkerFunctionProfile,
} from './json/function_profile';
import { Config } from '#self/config';
import { Event, EventBus } from './event-bus';
import { DependencyContext } from './dependency_context';

const logger = loggers.get('function_profile');

export type Mode = 'IMMEDIATELY' | 'WAIT';

/**
 * Per function profile
 */
// @ts-expect-error Mixin type
export interface PerFunctionProfile
  extends NodejsFunctionProfile,
    AworkerFunctionProfile {}
export class PerFunctionProfile {
  #json;
  #config;
  proxy;

  /**
   * constructor
   * @param json The raw function profile.
   * @param config The global config object.
   */
  constructor(json: RawFunctionProfile, config?: Config) {
    this.#json = Object.assign({}, JSON.parse(JSON.stringify(json)));
    this.#config = config;
    this.proxy = new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) {
          if (typeof (target as any)[prop] === 'function') {
            return (target as any)[prop].bind(this);
          }

          return (target as any)[prop];
        }

        return this.#json[prop];
      },

      set: (target, prop, value) => {
        if (prop in target) {
          return true;
        }

        this.#json[prop] = value;
        return true;
      },
    });

    return this.proxy;
  }

  /**
   * To JSON object.
   * @param {boolean} [withDefault] Fill undefined fields with default value.
   * @return {RawFunctionProfile} The raw function profile.
   */
  toJSON(withDefault = false): RawWithDefaultsFunctionProfile {
    /**
     * @type {RawFunctionProfile}
     */
    const ret = JSON.parse(JSON.stringify(this.#json));
    if (withDefault) {
      if (!ret.worker) ret.worker = {};
      ret.worker = {
        shrinkStrategy: this.#config?.worker.defaultShrinkStrategy,
        initializationTimeout: this.#config?.worker.defaultInitializerTimeout,
        reservationCount: this.#config?.worker.reservationCountPerFunction,
        replicaCountLimit: this.#config?.worker.replicaCountLimit,
        maxActivateRequests: this.#config?.worker.maxActivateRequests,
        fastFailRequestsOnStarting: false,
        v8Options: [],
        execArgv: [],
        ...ret.worker,
      };

      if (!ret.resourceLimit) ret.resourceLimit = {};
      ret.resourceLimit = {
        memory: SPEC_JSON.linux.resources.memory.limit,
        ...ret.resourceLimit,
      };
    }
    return ret;
  }

  /**
   * Generate `PerFunctionProfile`s from a JSON array
   * @param arr The JSON array.
   * @param config The global config object.
   * @return The `PerFunctionProfile` array.
   */
  static fromJSONArray(arr: RawFunctionProfile[], config?: Config) {
    return arr.map(item => new PerFunctionProfile(item, config));
  }
}

interface QueueItem {
  profile: RawFunctionProfile[];
  immediatelyInterrupted: boolean;
  deferred: utils.Deferred<void>;
}

interface FunctionProfileUpdateEventData {
  profile: RawFunctionProfile[];
  mode: Mode;
}
export class FunctionProfileUpdateEvent extends Event {
  static type = 'function-profile-updated';
  constructor(public data: FunctionProfileUpdateEventData) {
    super(FunctionProfileUpdateEvent.type);
  }
}

export type FunctionProfileManagerContext = {
  eventBus: EventBus;
  config: Config;
};
/**
 * Function profile manager
 */
export class FunctionProfileManager extends EventEmitter {
  private _eventBus: EventBus;
  private _config: Config;
  setQueue;
  setQueueRunning;
  profile: PerFunctionProfile[];
  jsonValidator;
  internal;

  constructor(ctx: DependencyContext<FunctionProfileManagerContext>) {
    super();
    this._eventBus = ctx.getInstance('eventBus');
    this._config = ctx.getInstance('config');

    this.setQueue = new LinkList<QueueItem>();
    this.setQueueRunning = false;

    this.profile = [];
    this.jsonValidator = new JSONValidator();
    this.internal = {
      async IMMEDIATELY(
        this: FunctionProfileManager,
        profile: RawFunctionProfile[]
      ) {
        this.profile = PerFunctionProfile.fromJSONArray(profile, this._config);
        this._eventBus
          .publish(
            new FunctionProfileUpdateEvent({
              profile: this.profile,
              mode: 'IMMEDIATELY',
            })
          )
          .catch(e => {
            logger.warn('Failed to publish FunctionProfileUpdateEvent:', e);
          }); // do not await
        logger.debug('Function profile has been updated: %j', this.profile);
        this.emit('changed', this.profile);

        // interrupt waiting profiles (but not stop the downloading tasks)
        let node = this.setQueue.nodeAt(0);

        // + node === null: no any node
        // + node.next === null: it's an empty tail node
        while (node && node.next) {
          node.value!.immediatelyInterrupted = true;
          node = node.next;
        }
      },

      async WAIT(this: FunctionProfileManager, profile: RawFunctionProfile[]) {
        const deferred = utils.createDeferred<void>();
        this.setQueue.pushBack({
          profile,
          immediatelyInterrupted: false,
          deferred,
        });

        logger.debug('Code relation is up to update.', JSON.stringify(profile));

        if (!this.setQueueRunning) {
          this.setQueueRunning = true;
          this._runSetQueue.call(this);
        }

        return deferred.promise;
      },
    };
  }

  /**
   * Get function profile via name
   * @param name The function name
   * @return The got function profile
   */
  get(name: string) {
    for (const item of this.profile) {
      if (item.name === name) {
        return item;
      }
    }

    return null;
  }

  /**
   * Set the whole profile
   * @param profile The whole function profile
   * @param mode The set mode
   */
  async set(profile: RawFunctionProfile[], mode: Mode) {
    if (!this.internal[mode]) {
      throw new Error(`Invalid set mode ${mode}.`);
    }

    const ret = this.jsonValidator.validate(profile, SCHEMA_JSON as any);
    if (!ret.valid) {
      throw ret.errors[0] || new Error('invalid function profile');
    }

    try {
      await this.internal[mode].call(this, profile);
    } catch (error) {
      logger.warn('[FunctionProfile] set profile failed: ', error);
    }
  }

  /**
   * Run set queue
   * @return {Promise<void>} void
   */
  async _runSetQueue() {
    const { profile, deferred } = this.setQueue.valueAt(0)!;

    const stringified = JSON.stringify(profile);
    logger.debug('Updating code relation.', stringified);

    let errored = false;
    let error;
    try {
      await this._eventBus.publish(
        new FunctionProfileUpdateEvent({
          profile,
          mode: 'WAIT',
        })
      );
    } catch (e) {
      errored = true;
      error = e;
    }

    if (!errored) {
      if (!this.setQueue.valueAt(0)!.immediatelyInterrupted) {
        this.profile = PerFunctionProfile.fromJSONArray(profile, this._config);
        logger.debug('Code relation has been delayed-updated', stringified);
        this.emit('changed', this.profile, false);
      } else {
        logger.debug('Code relation has been interrupted', stringified);
      }
      deferred.resolve();
    } else {
      logger.error('Failed to ensure codes with `_runSetQueue()`.', error);
      deferred.reject(error);
    }

    this.setQueue.popFront();
    if (this.setQueue.length) {
      this._runSetQueue();
    } else {
      this.setQueueRunning = false;
    }
  }
}
