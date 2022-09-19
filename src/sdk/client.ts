import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { Validator as JSONValidator } from 'jsonschema';
import { config, dumpConfig } from '#self/config';
import loggers from '#self/lib/logger';
import { tuplesToPairs, pairsToTuples, mapToPairs } from '#self/lib/rpc/key_value_pair';
import { TriggerResponse, MetadataInit, Metadata } from '#self/delegate/request_response';
import { bufferFromStream, DeepRequired, jsonClone } from '#self/lib/util';
import { DataPlaneClientManager } from './data_plane_client_manager';
import { ControlPlaneClientManager } from './control_plane_client_manager';
// json could not be loaded with #self.
import kServiceProfileSchema from '../lib/json/service_profile_schema.json';
import { Logger } from '#self/lib/loggers';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { Mode } from '#self/lib/function_profile';
import { ServiceProfileItem } from '#self/data_plane/service_selector';
import * as root from '#self/proto/root';
import { kDefaultRequestId } from '#self/lib/constants';

/**
 * Alice client
 */
export class AliceClient extends EventEmitter {
  dataPlaneClientManager: DataPlaneClientManager;
  controlPlaneClientManager: ControlPlaneClientManager;
  logger: Logger;
  validator: JSONValidator;
  functionProfiles: RawFunctionProfile[] | null;
  functionProfilesMode: Mode;
  serviceProfiles: root.alice.data.IFunctionService[] | null;
  useInspectorSet: Set<string>;
  daprAdaptorModulePath: string;
  platformEnvironmentVariables: root.alice.IKeyValuePair[];

  constructor() {
    super();
    loggers.setSink(loggers.getPrettySink('sdk.log'));
    dumpConfig('sdk', config);

    this.dataPlaneClientManager = new DataPlaneClientManager(this, config);
    this.controlPlaneClientManager = new ControlPlaneClientManager(this, config);
    this.logger = loggers.get('alice client');
    this.validator = new JSONValidator();

    this.functionProfiles = null;
    this.functionProfilesMode = 'IMMEDIATELY';
    this.serviceProfiles = null;
    this.useInspectorSet = new Set();
    this.daprAdaptorModulePath = '';
    this.platformEnvironmentVariables = [];
  }

  /**
   * Start alice client
   * @return {Promise<void>} The result.
   */
  async start() {
    this.logger.debug('starting...');

    this.dataPlaneClientManager.on('newClientReady', plane => this.emit('newDataPlaneClientReady', plane));
    this.controlPlaneClientManager.on('newClientReady', plane => this.emit('newControlPlaneClientReady', plane));

    await Promise.all([
      this.dataPlaneClientManager.ready(),
      this.controlPlaneClientManager.ready(),
    ]);
    this.logger.info('started.');
  }

  /**
   * Close alice client
   * @return {Promise<void>} The result.
   */
  async close() {
    await Promise.all([
      this.dataPlaneClientManager.close(),
      this.controlPlaneClientManager.close(),
    ]);
  }

  /**
   * Invoke function.
   * @param {string} name The function name.
   * @param {Readable | Buffer} data Input data.
   * @param {import('#self/delegate/request_response').Metadata} metadata The metadata.
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The invoke response.
   */
  async invoke(name: string, data: Readable | Buffer, metadata?: InvokeMetadata) {
    return this.#invoke('invoke', name, data, metadata);
  }

  /**
   * Invoke service.
   * @param {string} name The service name.
   * @param {Readable | Buffer} data Input data.
   * @param {import('#self/delegate/request_response').Metadata} metadata The metadata.
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The invoke response.
   */
  async invokeService(name: string, data: Readable | Buffer, metadata?: InvokeMetadata) {
    return this.#invoke('invokeService', name, data, metadata);
  }

  /**
   * Set dapr adapter.
   * @param {string} modulePath The dapr module path.
   * @return {Promise<void>} The result.
   */
  async setDaprAdaptor(modulePath: string) {
    await this.dataPlaneClientManager.callToAllAvailableClients('setDaprAdaptor', [{ modulePath }], 'all');
    this.daprAdaptorModulePath = modulePath;
  }

  /**
   * Set platform environment variables.
   * @param {import('#self/lib/proto/alice/common').KeyValuePair[]} envs The environment variables pair.
   * @return {Promise<void>} The result.
   */
  async setPlatformEnvironmentVariables(envs: root.alice.IKeyValuePair[]) {
    // wash envs and throw Error if neccessary
    envs.forEach(kv => {
      if ((kv.key as string).startsWith('ALICE_') || (kv.key as string).startsWith('NOSLATE_')) {
        throw new Error(
          `Platform environment variables' key can't start with ALICE_ and NOSLATE_. (Failed: ${kv.key})`);
      } if (typeof kv.value !== 'string' && kv.value !== undefined && kv.value !== null) {
        throw new Error(
          `Platform environment variables' value can't be out of string. (Failed: ${kv.key}, ` +
          `${kv.value} (${typeof kv.value}))`);
      }
    });

    const client = this.controlPlaneClientManager.sample();
    envs = jsonClone(envs);
    for (const env of envs) {
      if (env.value === undefined || env.value === null) {
        env.value = '';
      }
    }

    // Set platform environment variables. If failed, do not cache current `platformEnvironmentVariables`.
    if (client) {
      const ret = await (client as any).setPlatformEnvironmentVariables({ envs });
      if (!ret?.set) {
        throw new Error('Platform environment variables didn\'t set.');
      }
    }

    this.platformEnvironmentVariables = envs;
  }

  /**
   * Get platform environment variables.
   * @return {import('#self/lib/proto/alice/common').KeyValuePair[]} envs The environment variables pair.
   */
  getPlatformEnvironmentVariables() {
    return this.platformEnvironmentVariables;
  }

  /**
   * Set function profile.
   * @param {import('#self/lib/json/function_profile').RawFunctionProfile[]} profiles function profile
   * @param {'IMMEDIATELY' | 'WAIT'} mode set mode
   */
  async setFunctionProfile(profiles: RawFunctionProfile[], mode: Mode = 'IMMEDIATELY') {
    const client = this.controlPlaneClientManager.sample();
    profiles = JSON.parse(JSON.stringify(profiles));

    // Set function profile. If failed, do not cache current `functionProfilesMode`
    // and `functionProfiles`.
    if (client) {
      const ret = await (client as any).setFunctionProfile({ profiles, mode });
      if (!ret?.set) {
        throw new Error('Function profile didn\'t set.');
      }
    }

    this.functionProfilesMode = mode;
    this.functionProfiles = profiles;
  }

  /**
   * Get funciton profile.
   * @return {import('#self/lib/json/function_profile').RawFunctionProfile[]} The function profile.
   */
  getFunctionProfile() {
    return this.functionProfiles;
  }

  /**
   * Set service profile.
   * @param {any[]} profiles service profile
   */
  async setServiceProfile(profiles: ServiceProfileItem[]) {
    this.validator.validate(profiles, kServiceProfileSchema);
    profiles = jsonClone(profiles);

    const serviceProfiles: root.alice.data.IFunctionService[] = profiles.map(it => {
      const item: root.alice.data.IFunctionService = {
        name: it.name,
        type: it.type
      };

      if (it.selector) {
        item.selector = mapToPairs<string>(it.selector as Record<'functionName', string>);
      }
      if (it.selectors) {
        item.selectors = it.selectors.map(it => {
          return {
            proportion: it.proportion,
            selector: mapToPairs(it.selector as Record<'functionName', string>)
          };
        });
      }
      return item;
    });

    await this.dataPlaneClientManager.callToAllAvailableClients('setServiceProfiles', [{ profiles: serviceProfiles }], 'all');
    this.serviceProfiles = serviceProfiles;
  }

  /**
   * Get service profile.
   * @return {any[]} The result.
   */
  getServiceProfile() {
    return this.serviceProfiles ?? [];
  }

  /**
   * Set a function whether using inspector or not.
   * @param {string} funcName The function name.
   * @param {boolean} use Wheher using inspector or not.
   * @return {Promise<void>} The result.
   */
  async useInspector(funcName: string, use: boolean) {
    if (use) {
      this.useInspectorSet.add(funcName);
    } else {
      this.useInspectorSet.delete(funcName);
    }

    await this.dataPlaneClientManager.callToAllAvailableClients('useInspector', [{ funcName, use }], 'all');
  }

  /**
   * Invoke.
   * @param {'invoke' | 'invokeService'} type The invoke type.
   * @param {string} name The name.
   * @param {Readable | Buffer} data Input data.
   * @param {import('#self/delegate/request_response').Metadata} metadata The metadata.
   * @return {Promise<import('#self/delegate/request_response').TriggerResponse>} The invoke response.
   */
  async #invoke(type: InvokeType, name: string, data: Readable | Buffer, metadata?: InvokeMetadata): Promise<TriggerResponse> {
    /** @type {DataPlaneClient} */
    const plane = this.dataPlaneClientManager.sample();
    if (plane == null) {
      throw new Error('No activated data plane.');
    }

    let body;
    if (data instanceof Readable) {
      // TODO: stream support;
      body = await bufferFromStream(data);
    } else if (data instanceof Buffer) {
      body = data;
    }

    const result: DeepRequired<root.alice.data.IInvokeResponse> = await plane[type]({
      name,
      url: metadata?.url,
      method: metadata?.method,
      headers: tuplesToPairs(metadata?.headers ?? []),
      baggage: tuplesToPairs(metadata?.baggage ?? []),
      // TODO: negotiate with deadline;
      timeout: metadata?.timeout,
      body,
      requestId: metadata?.requestId ?? kDefaultRequestId
    } as root.alice.data.IInvokeRequest, {
      // TODO: proper deadline definition;
      deadline: Date.now() + (metadata?.timeout ?? 10_000) + 1_000,
    });
    if (result.error) {
      const error = new Error();
      Object.assign(error, result.error);
      throw error;
    }

    const response = new TriggerResponse({
      status: result.result.status,
      metadata: new Metadata({
        headers: pairsToTuples(result.result.headers ?? []),
      }),
    });

    response.push(result.result.body);
    response.push(null);

    return response;
  }
}

interface InvokeMetadata extends MetadataInit {
  requestId?: string;
}

type InvokeType = 'invoke' | 'invokeService';
