import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { Validator as JSONValidator } from 'jsonschema';
import { config, dumpConfig } from '#self/config';
import loggers from '#self/lib/logger';
import {
  tuplesToPairs,
  pairsToTuples,
  mapToPairs,
} from '#self/lib/rpc/key_value_pair';
import {
  TriggerResponse,
  MetadataInit,
  Metadata,
} from '#self/delegate/request_response';
import { createDeferred, DeepRequired, jsonClone } from '#self/lib/util';
import { DataPlaneClientManager } from './data_plane_client_manager';
import { ControlPlaneClientManager } from './control_plane_client_manager';
// json could not be loaded with #self.
import kServiceProfileSchema from '../lib/json/service_profile_schema.json';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { FunctionProfileManager, Mode } from '#self/lib/function_profile';
import { ServiceProfileItem } from '#self/data_plane/service_selector';
import * as root from '#self/proto/root';
import { kDefaultRequestId } from '#self/lib/constants';
import { ClientDuplexStream } from '@grpc/grpc-js';
import { isUint8Array } from 'util/types';
import { LoggerFactory, PrefixedLogger } from '#self/lib/logger_factory';
import { ILogger } from '@midwayjs/logger';

/**
 * Noslated client
 */
export class NoslatedClient extends EventEmitter {
  dataPlaneClientManager: DataPlaneClientManager;
  controlPlaneClientManager: ControlPlaneClientManager;
  logger: PrefixedLogger;
  validator: JSONValidator;
  functionProfiles: RawFunctionProfile[] | null;
  functionProfilesMode: Mode;
  serviceProfiles: root.noslated.data.IFunctionService[] | null;
  useInspectorSet: Set<string>;
  platformEnvironmentVariables: root.noslated.IKeyValuePair[];

  constructor(options?: NoslatedClientOptions) {
    super();
    dumpConfig('sdk', config);

    LoggerFactory.init('sdk.log', options?.logger);
    this.logger = LoggerFactory.prefix('noslated client');

    this.dataPlaneClientManager = new DataPlaneClientManager(this, config);
    this.controlPlaneClientManager = new ControlPlaneClientManager(
      this,
      config
    );
    this.validator = new JSONValidator();

    this.functionProfiles = null;
    this.functionProfilesMode = 'IMMEDIATELY';
    this.serviceProfiles = null;
    this.useInspectorSet = new Set();
    this.platformEnvironmentVariables = [];
  }

  /**
   * Start noslated client
   */
  async start() {
    this.logger.debug('starting...');

    this.dataPlaneClientManager.on('newClientReady', plane =>
      this.emit('newDataPlaneClientReady', plane)
    );
    this.controlPlaneClientManager.on('newClientReady', plane =>
      this.emit('newControlPlaneClientReady', plane)
    );

    await Promise.all([
      this.dataPlaneClientManager.ready(),
      this.controlPlaneClientManager.ready(),
    ]);
    this.logger.info('started.');
  }

  /**
   * Close noslated client
   */
  async close() {
    await Promise.all([
      this.dataPlaneClientManager.close(),
      this.controlPlaneClientManager.close(),
      LoggerFactory.close(),
    ]);
  }

  /**
   * Invoke function.
   */
  async invoke(name: string, data: Readable | Buffer, metadata?: MetadataInit) {
    return this.#invoke('invoke', name, data, metadata);
  }

  /**
   * Invoke service.
   */
  async invokeService(
    name: string,
    data: Readable | Buffer,
    metadata?: MetadataInit
  ) {
    return this.#invoke('invokeService', name, data, metadata);
  }

  /**
   * Set platform environment variables.
   */
  async setPlatformEnvironmentVariables(envs: root.noslated.IKeyValuePair[]) {
    // wash envs and throw Error if neccessary
    envs.forEach(kv => {
      if (
        (kv.key as string).startsWith('NOSLATED_') ||
        (kv.key as string).startsWith('NOSLATE_')
      ) {
        throw new Error(
          `Platform environment variables' key can't start with NOSLATED_ and NOSLATE_. (Failed: ${kv.key})`
        );
      }
      if (
        typeof kv.value !== 'string' &&
        kv.value !== undefined &&
        kv.value !== null
      ) {
        throw new Error(
          `Platform environment variables' value can't be out of string. (Failed: ${kv.key}, ` +
            `${kv.value} (${typeof kv.value}))`
        );
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
      const ret = await (client as any).setPlatformEnvironmentVariables({
        envs,
      });
      if (!ret?.set) {
        throw new Error("Platform environment variables didn't set.");
      }
    }

    this.platformEnvironmentVariables = envs;
  }

  async checkControlPlaneHealth(
    timeout = 1000
  ): Promise<root.noslated.IPlaneHealthyResponse> {
    try {
      const client = this.controlPlaneClientManager.sample();

      return await (client as any).checkHealth(
        {},
        { deadline: Date.now() + timeout }
      );
    } catch (error) {
      return {
        health: false,
        name: 'ControlPlane',
        reason: (error as Error).message,
      };
    }
  }

  async checkDataPlaneHealth(
    timeout = 1000
  ): Promise<root.noslated.IPlaneHealthyResponse> {
    const client = this.dataPlaneClientManager.sample();

    try {
      return await (client as any).checkHealth(
        {},
        { deadline: Date.now() + timeout }
      );
    } catch (error) {
      return {
        health: false,
        name: 'DataPlane',
        reason: (error as Error).message,
      };
    }
  }

  async getWorkerStatsSnapshot(): Promise<root.noslated.control.IWorkerStatsSnapshotResponse> {
    const client = this.controlPlaneClientManager.sample();

    return (client as any).getWorkerStatsSnapshot({});
  }

  /**
   * Get platform environment variables.
   */
  getPlatformEnvironmentVariables(): root.noslated.IKeyValuePair[] {
    return this.platformEnvironmentVariables;
  }

  /**
   * Set function profile.
   */
  async setFunctionProfile(
    profiles: RawFunctionProfile[],
    mode: Mode = 'IMMEDIATELY'
  ) {
    FunctionProfileManager.validate(profiles);
    const client = this.controlPlaneClientManager.sample();
    profiles = JSON.parse(JSON.stringify(profiles));

    // Set function profile. If failed, do not cache current `functionProfilesMode`
    // and `functionProfiles`.
    if (client) {
      const ret = await (client as any).setFunctionProfile({ profiles, mode });
      if (!ret?.set) {
        throw new Error("Function profile didn't set.");
      }
    }

    this.functionProfilesMode = mode;
    this.functionProfiles = profiles;
  }

  /**
   * Get function profile.
   */
  getFunctionProfile() {
    return this.functionProfiles;
  }

  /**
   * Set service profile.
   */
  async setServiceProfile(profiles: ServiceProfileItem[]) {
    this.validator.validate(profiles, kServiceProfileSchema);
    profiles = jsonClone(profiles);

    const serviceProfiles: root.noslated.data.IFunctionService[] = profiles.map(
      it => {
        const item: root.noslated.data.IFunctionService = {
          name: it.name,
          type: it.type,
        };

        if (it.selector) {
          item.selector = mapToPairs<string>(
            it.selector as Record<'functionName', string>
          );
        }
        if (it.selectors) {
          item.selectors = it.selectors.map(it => {
            return {
              proportion: it.proportion,
              selector: mapToPairs(
                it.selector as Record<'functionName', string>
              ),
            };
          });
        }
        return item;
      }
    );

    await this.dataPlaneClientManager.callToAllAvailableClients(
      'setServiceProfiles',
      [{ profiles: serviceProfiles }],
      'all'
    );
    this.serviceProfiles = serviceProfiles;
  }

  /**
   * Get service profile.
   */
  getServiceProfile() {
    return this.serviceProfiles ?? [];
  }

  /**
   * Set a function whether using inspector or not.
   */
  async useInspector(funcName: string, use: boolean) {
    if (use) {
      this.useInspectorSet.add(funcName);
    } else {
      this.useInspectorSet.delete(funcName);
    }

    await this.dataPlaneClientManager.callToAllAvailableClients(
      'useInspector',
      [{ funcName, use }],
      'all'
    );
  }

  /**
   * Invoke.
   */
  async #invoke(
    type: InvokeType,
    name: string,
    data: Readable | Buffer,
    metadata?: MetadataInit
  ): Promise<TriggerResponse> {
    const plane = this.dataPlaneClientManager.sample();
    if (plane == null) {
      throw new Error('No activated data plane.');
    }

    const call: ClientDuplexStream<
      root.noslated.data.IInvokeRequest,
      root.noslated.data.InvokeResponse
    > = plane[type]({
      deadline:
        (metadata?.deadline ?? Date.now() + (metadata?.timeout ?? 10_000)) +
        1000,
    });

    const headerMsg: root.noslated.data.IInvokeRequest = {
      name,
      url: metadata?.url,
      method: metadata?.method,
      headers: tuplesToPairs(metadata?.headers ?? []),
      baggage: tuplesToPairs(metadata?.baggage ?? []),
      deadline:
        metadata?.deadline ?? Date.now() + (metadata?.timeout ?? 10_000),
      requestId: metadata?.requestId ?? kDefaultRequestId,
      debuggerTag: metadata?.debuggerTag,
    };
    // Fast path for buffer request.
    if (isUint8Array(data)) {
      headerMsg.body = data;
    }
    call.write(headerMsg);

    if (data instanceof Readable) {
      data.on('data', chunk => {
        call.write({
          body: chunk,
        });
      });
      data.on('end', () => {
        call.end();
      });
      data.on('error', () => {
        call.cancel();
      });
    } else {
      call.end();
    }

    const res = await this._parseClientDuplexStream(call);
    return res;
  }

  private _parseClientDuplexStream(
    call: ClientDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<TriggerResponse> {
    const deferred = createDeferred<TriggerResponse>();
    let headerReceived = false;
    let hasErrored = false;
    let res: TriggerResponse;
    call.on('data', (msg: root.noslated.data.InvokeResponse) => {
      if (msg.error) {
        const error = new Error();
        Object.assign(error, msg.error);

        if (headerReceived) {
          res.destroy(error);
        } else {
          deferred.reject(error);
        }
        return;
      }
      const result = msg.result!;
      if (!headerReceived) {
        headerReceived = true;
        res = new TriggerResponse({
          read: () => {},
          destroy: (err, cb) => {
            /** cancel the call in any conditions */
            call.cancel();
            /** emit error event */
            process.nextTick(() => cb(err));
          },
          status: result.status!,
          metadata: new Metadata({
            headers: pairsToTuples(
              (result.headers as DeepRequired<root.noslated.IKeyValuePair[]>) ??
                []
            ),
          }),
        });
        deferred.resolve(res);
        return;
      }
      if (result.body) {
        res.push(result.body);
      }
    });
    call.on('end', () => {
      /** Avoid emitting 'end' event on response when the call has emitted error */
      if (hasErrored) {
        return;
      }
      if (headerReceived) {
        res.push(null);
      } else {
        deferred.reject(new Error('No headers received'));
      }
    });
    call.on('error', e => {
      hasErrored = true;
      if (headerReceived) {
        res.destroy(e);
      } else {
        deferred.reject(e);
      }
    });

    return deferred.promise;
  }
}

type InvokeType = 'invoke' | 'invokeService';

interface NoslatedClientOptions {
  logger?: ILogger;
}
