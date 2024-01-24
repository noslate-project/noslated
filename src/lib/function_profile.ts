import { Validator as JSONValidator } from 'jsonschema';
import loggers from './logger';
import SCHEMA_JSON from './json/function_profile_schema.json';
import SPEC_JSON from './json/spec.template.json';
import {
  NodejsFunctionProfile,
  RawFunctionProfile,
  RawWithDefaultsFunctionProfile,
  AworkerFunctionProfile,
  optionalKeys,
} from './json/function_profile';
import { Config } from '#self/config';
import { Event, EventBus } from './event-bus';
import { DependencyContext } from './dependency_context';
import _ from 'lodash';
import { TaskQueue } from './task_queue';

const logger = loggers.get('function_profile');

/**
 * Keys updated that requires reload of the workers.
 */
const FunctionProfileUpdateKeys = [
  'runtime',
  'url',
  'signature',
  'sourceFile',
  'handler',
  'initializer',
  'resourceLimit.cpu',
  'resourceLimit.memory',
] as const;

export type Mode = 'IMMEDIATELY' | 'WAIT';

function buildProfile(
  json: RawFunctionProfile,
  config: Config
): RawWithDefaultsFunctionProfile {
  const profile: any = {
    resourceLimit: {
      memory: SPEC_JSON.linux.resources.memory.limit,
      ...json.resourceLimit,
    },
    worker: {
      shrinkStrategy: config.worker.defaultShrinkStrategy,
      initializationTimeout: config.worker.defaultInitializerTimeout,
      reservationCount: config.worker.reservationCountPerFunction,
      replicaCountLimit: config.worker.replicaCountLimit,
      maxActivateRequests: config.worker.maxActivateRequests,
      fastFailRequestsOnStarting: false,
      disableRequestQueue: false,
      v8Options: [],
      execArgv: [],

      concurrencySlidingWindowSize: config.worker.concurrencySlidingWindowSize,
      concurrencySlidingBucketCount:
        config.worker.concurrencySlidingBucketCount,
      emaConcurrencyAlpha: config.worker.emaConcurrencyAlpha,
      concurrencyExpandThreshold: config.worker.concurrencyExpandThreshold,
      concurrencyShrinkThreshold: config.worker.concurrencyShrinkThreshold,
      expandCooldown: config.worker.expandCooldown,
      shrinkCooldown: config.worker.shrinkCooldown,
      scaleFactor: config.worker.scaleFactor,
      precisionZeroThreshold: config.worker.precisionZeroThreshold,
      concurrencyStatsMode: config.worker.concurrencyStatsMode,
      shrinkCooldownOnStartup: config.worker.shrinkCooldownOnStartup,

      ...(json.worker ?? {}),
    },
    environments: json.environments ?? [],
    name: json.name,
    url: json.url,
    signature: json.signature,
    runtime: json.runtime,
  };
  if (json.runtime === 'nodejs') {
    profile.handler = (json as NodejsFunctionProfile).handler;
    profile.initializer = (json as NodejsFunctionProfile).initializer;
  } else {
    profile.sourceFile = (json as AworkerFunctionProfile).sourceFile;
  }
  for (const key of optionalKeys) {
    if (json[key]) {
      profile[key] = json[key];
    }
  }
  return profile as RawWithDefaultsFunctionProfile;
}

interface QueueItem {
  profiles: RawFunctionProfile[];
}

export class FunctionsRemovedEvent extends Event {
  static type = 'functions-removed';
  constructor(public data: string[]) {
    super(FunctionsRemovedEvent.type);
  }
}

export class FunctionProfileUpdateEvent extends Event {
  static type = 'function-profile-updated';
  constructor(public data: RawWithDefaultsFunctionProfile[]) {
    super(FunctionProfileUpdateEvent.type);
  }
}

export const FunctionProfileManagerEvents = [
  FunctionsRemovedEvent,
  FunctionProfileUpdateEvent,
];

export type FunctionProfileManagerContext = {
  eventBus: EventBus;
  config: Config;
};
/**
 * Function profile manager
 */
export class FunctionProfileManager {
  private static jsonValidator = new JSONValidator();
  static validate(profiles: any) {
    const ret = this.jsonValidator.validate(profiles, SCHEMA_JSON as any);
    if (!ret.valid) {
      throw ret.errors[0] || new Error('invalid function profile');
    }
  }

  private _eventBus: EventBus;
  private _config: Config;

  private _taskQueue: TaskQueue<QueueItem>;
  private _profiles = new Map<string, RawWithDefaultsFunctionProfile>();

  constructor(ctx: DependencyContext<FunctionProfileManagerContext>) {
    this._eventBus = ctx.getInstance('eventBus');
    this._config = ctx.getInstance('config');

    this._taskQueue = new TaskQueue(this._applyProfiles, {
      concurrency: 1,
    });
  }

  /**
   * Get function profile via name
   */
  getProfile(name: string) {
    return this._profiles.get(name);
  }

  /**
   * Set the whole profile
   * @param profile The whole function profile
   * @param mode The set mode
   */
  setProfiles(profiles: RawFunctionProfile[]): Promise<void> {
    this._taskQueue.clear();
    return this._taskQueue.enqueue({
      profiles,
    });
  }

  getProfiles(): RawWithDefaultsFunctionProfile[] {
    return Array.from(this._profiles.values());
  }

  private _applyProfiles = async (item: QueueItem) => {
    const profiles = new Map<string, RawWithDefaultsFunctionProfile>();
    for (const profile of item.profiles) {
      profiles.set(profile.name, buildProfile(profile, this._config));
    }
    const previous = this._profiles;
    this._profiles = profiles;

    // compare current to previous profiles, publish as removed.
    const removes: string[] = [];
    for (const profile of profiles.values()) {
      const previousItem = previous.get(profile.name);
      if (previousItem === undefined) continue;
      previous.delete(profile.name);

      const significantDiff = this._significantDiff(previousItem, profile);
      if (significantDiff) removes.push(profile.name);
    }
    removes.push(...Array.from(previous.keys()));

    try {
      await this._eventBus.publish(new FunctionsRemovedEvent(removes));
    } catch (e) {
      logger.warn('Failed to publish FunctionsRemovedEvent:', e);
    }

    try {
      await this._eventBus.publish(
        new FunctionProfileUpdateEvent(Array.from(profiles.values()))
      );
    } catch (e) {
      logger.warn('Failed to publish FunctionProfileUpdateEvent:', e);
    }
  };

  private _significantDiff(
    lhs: RawWithDefaultsFunctionProfile,
    rhs: RawWithDefaultsFunctionProfile
  ): boolean {
    for (const key of FunctionProfileUpdateKeys) {
      const a = _.get(lhs, key);
      const b = _.get(rhs, key);
      if (a !== b) {
        return true;
      }
    }
    return false;
  }
}
