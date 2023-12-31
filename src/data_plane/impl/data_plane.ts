import { pairsToMap, mapToPairs } from '#self/lib/rpc/key_value_pair';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { ServerUnaryCall } from '#self/lib/rpc/util';
import { DataFlowController } from '../data_flow_controller';
import { rpcAssert } from '#self/lib/rpc/error';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { NotNullableInterface } from '#self/lib/interfaces/';
import { ServiceProfileItem, ServiceType } from '../service_selector';
import { IDataPlane } from '#self/lib/interfaces/data_plane';
import { LoggerFactory } from '#self/lib/logger_factory';

const logger = LoggerFactory.prefix('data plane impl');

export class DataPlaneImpl implements IDataPlane {
  /**
   * Constructor
   * @param dataFlowController The data flow controller object.
   * @param config The global config object.
   */
  constructor(
    private dataFlowController: DataFlowController,
    private config: Config
  ) {}

  /**
   * No enough memory pool to start worker.
   * @param call The call object.
   * @return The result.
   */
  async startWorkerFastFail(
    call: ServerUnaryCall<root.noslated.data.IStartWorkerFastFailRequest>
  ): Promise<void> {
    const { request } = call;
    rpcAssert(request.funcName);
    rpcAssert(request.inspect != null);

    const broker = this.dataFlowController.getBroker(request.funcName, {
      inspect: request.inspect,
    });
    if (!broker) return;
    broker.fastFailAllPendingsDueToStartError(request);
  }

  async getWorkerTrafficStats(): Promise<root.noslated.data.IWorkerTrafficStatsResponse> {
    return {
      brokers: this.dataFlowController.getWorkerTrafficStats(),
    };
  }

  /**
   * Reduce capacity
   * @param call The call object.
   * @return The result.
   */
  async reduceCapacity(
    call: ServerUnaryCall<root.noslated.data.ICapacityReductionRequest>
  ): Promise<root.noslated.data.ICapacityReductionResponse> {
    const brokers = call.request.brokers ?? [];
    const closed = await this.dataFlowController.closeTraffic(brokers);
    return { brokers: closed };
  }

  /**
   * Set function profile (this is sent from control plane)
   * @param call The call object.
   * @return The result.
   */
  async setFunctionProfile(
    call: ServerUnaryCall<root.noslated.ISetFunctionProfileRequest>
  ): Promise<root.noslated.ISetFunctionProfileResponse> {
    const profiles = (call.request.profiles ?? []) as RawFunctionProfile[];

    try {
      await this.dataFlowController.setFunctionProfile(profiles);
    } catch (e) {
      logger.error('unexpected error on set function profile', e);
      return { set: false };
    }

    return { set: true };
  }

  /**
   * Set service profile
   * @param call The call object.
   */
  async setServiceProfiles(
    call: ServerUnaryCall<root.noslated.data.IServiceProfilesAccessor>
  ): Promise<void> {
    const profiles = call.request.profiles ?? [];

    const profilesByMap = profiles.map(it => {
      const item: ServiceProfileItem = {
        name: it.name!,
        type: it.type! as ServiceType,
      };

      if (it.selector) {
        item.selector = pairsToMap(
          it.selector as NotNullableInterface<root.noslated.IKeyValuePair>[]
        ) as Record<'functionName', string>;
      }
      if (it.selectors) {
        item.selectors = it.selectors.map(it => {
          return {
            proportion: it.proportion || 0,
            selector: pairsToMap(
              it.selector as NotNullableInterface<root.noslated.IKeyValuePair>[]
            ) as Record<'functionName', string>,
          };
        });
      }
      return item;
    });

    logger.info('set service profile with count: %d', profilesByMap.length);

    try {
      await this.dataFlowController.setServiceProfiles(profilesByMap);
    } catch (e) {
      logger.error(e);
    }
  }

  async getServiceProfiles(): Promise<root.noslated.data.IServiceProfilesAccessor> {
    const profiles = this.dataFlowController.serviceSelector.toJSON();

    const profilesAccessor: root.noslated.data.IFunctionService[] =
      profiles.map(it => {
        const item: root.noslated.data.IFunctionService = {
          name: it.name,
          type: it.type,
        };

        if (it.selector) {
          item.selector = mapToPairs(
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
      });
    return {
      profiles: profilesAccessor,
    };
  }

  /**
   * Set whether a function is using inspector (this is sent from SDK)
   */
  async useInspector(
    call: ServerUnaryCall<root.noslated.data.IUseInspectorRequest>
  ): Promise<void> {
    const { funcName, use } = call.request;
    rpcAssert(funcName != null);
    rpcAssert(use != null);
    const action = use ? 'open' : 'close';
    logger.info(`${action} '${funcName}' inspector.`);
    this.dataFlowController.useInspector(funcName, use);
  }

  async setTracingCategories(
    call: ServerUnaryCall<root.noslated.data.ISetTracingCategoriesRequest>
  ): Promise<void> {
    const { functionName, workerName } = call.request;
    const categories = call.request.categories ?? [];
    rpcAssert(functionName);

    const broker = this.dataFlowController.getBroker(functionName, {
      inspect: false,
    });

    if (broker == null) {
      logger.info('broker not found', functionName);
      return;
    }

    await Promise.all(
      Array.from(broker.workers()).map(it => {
        if (workerName && it.name !== workerName) {
          return;
        }
        if (categories.length > 0) {
          return it.delegate.tracingStart(it.credential, categories);
        } else {
          return it.delegate.tracingStop(it.credential);
        }
      })
    );
  }

  async startInspector(
    call: ServerUnaryCall<root.noslated.data.IStartInspectorRequest>
  ): Promise<void> {
    const { functionName, workerName } = call.request;
    rpcAssert(functionName);

    const broker = this.dataFlowController.getBroker(functionName, {
      inspect: false,
    });

    if (broker == null) {
      logger.info('broker not found', functionName);
      return;
    }

    await Promise.all(
      Array.from(broker.workers()).map(it => {
        if (workerName && it.name !== workerName) {
          return;
        }
        return it.delegate.inspectorStart(it.credential);
      })
    );
  }

  async getInspectorTargets() {
    const inspectorAgent = this.dataFlowController.inspectorAgent;
    if (inspectorAgent == null) {
      return { targets: [] };
    }
    const inspectorTargets = inspectorAgent.getInspectorTargets().map(it => {
      const url = new URL(it.url);
      const { 1: functionName, 2: workerName } = url.pathname.split('/');
      return {
        functionName,
        workerName,
        inspectorUrl: it.webSocketDebuggerUrl,
      };
    });
    const targets = Array.from(
      this.dataFlowController.brokers.values()
    ).flatMap(broker => {
      return Array.from(broker.workers()).map(worker => {
        return {
          functionName: broker.name,
          workerName: worker.name,
          debuggerTag: worker.debuggerTag,
          inspectorUrl: inspectorTargets.find(
            it =>
              it.functionName === broker.name && it.workerName === worker.name
          )?.inspectorUrl,
        };
      });
    });

    return {
      targets,
    };
  }

  /**
   * Register worker credential
   */
  async registerWorkerCredential(
    call: ServerUnaryCall<root.noslated.data.IRegisterWorkerCredentialRequest>
  ) {
    const { funcName, processName, credential, inspect } = call.request;
    rpcAssert(
      funcName != null &&
        processName != null &&
        credential != null &&
        inspect != null
    );
    this.dataFlowController.registerWorkerCredential(
      funcName,
      processName,
      credential,
      { inspect: !!inspect }
    );
    return {};
  }

  /**
   * Returns the server sock path
   * @return {root.noslated.data.IServerSockPathResponse} The result.
   */
  async serverSockPath(): Promise<root.noslated.data.IServerSockPathResponse> {
    return {
      path: this.dataFlowController.delegate.serverSockPath(),
    };
  }

  async checkHealth(): Promise<root.noslated.IPlaneHealthyResponse> {
    // TODO: add health check action
    const breakerEnabled = this.dataFlowController.circuitBreaker.opened;

    return {
      name: 'DataPlane',
      health: !breakerEnabled,
      reason: breakerEnabled ? 'Circuit Breaker Enabled' : '',
    };
  }
}
