import { pairsToMap, mapToPairs } from '#self/lib/rpc/key_value_pair';
import loggers from '#self/lib/logger';
import { Config } from '#self/config';
import * as root from '#self/proto/root';
import { ServerUnaryCall } from '#self/lib/rpc/util';
import { DataFlowController } from '../data_flow_controller';
import { rpcAssert } from '#self/lib/rpc/error';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { NotNullableInterface } from '#self/lib/interfaces/';
import { ServiceProfileItem, ServiceType } from '../service_selector';
import { IDataPanel } from '#self/lib/interfaces/data_panel';

const logger = loggers.get('data panel impl');

export class DataPanelImpl implements IDataPanel {

  /**
   * Constructor
   * @param dataFlowController The data flow controller object.
   * @param eagleeyeTracer -
   * @param config The global config object.
   */
  constructor(private dataFlowController: DataFlowController, private config: Config) {}

  /**
   * No enough memory pool to start worker.
   * @param call The call object.
   * @return The result.
   */
  async startWorkerFastFail(call: ServerUnaryCall<root.alice.data.IStartWorkerFastFailRequest>): Promise<void> {
    const { request } = call;
    rpcAssert(request.funcName);
    rpcAssert(request.inspect != null);

    const broker = this.dataFlowController.getBroker(request.funcName, { inspect: request.inspect });
    if (!broker) return;
    broker.fastFailAllPendingsDueToStartError(request);
  }

  /**
   * Reduce capacity
   * @param call The call object.
   * @return The result.
   */
  async reduceCapacity(call: ServerUnaryCall<root.alice.data.ICapacityReductionRequest>): Promise<root.alice.data.ICapacityReductionResponse> {
    const brokers = call.request.brokers ?? [];
    const closed = await this.dataFlowController.closeTraffic(brokers);
    return { brokers: closed };
  }

  /**
   * Set function profile (this is sent from control panel)
   * @param call The call object.
   * @return The result.
   */
  async setFunctionProfile(call: ServerUnaryCall<root.alice.ISetFunctionProfileRequest>):  Promise<root.alice.ISetFunctionProfileResponse> {
    const profiles = (call.request.profiles ?? []) as RawFunctionProfile[];
    const mode = call.request.mode ?? 'WAIT';
    rpcAssert(mode === 'IMMEDIATELY' || mode === 'WAIT');

    logger.info('set function profiles count: %d', profiles.length);

    try {
      await this.dataFlowController.setFunctionProfile(profiles, mode);
    } catch (e) {
      logger.error(e);
      return { set: false };
    }

    return { set: true };
  }

  /**
   * Set service profile
   * @param call The call object.
   */
  async setServiceProfiles(call: ServerUnaryCall<root.alice.data.IServiceProfilesAccessor>): Promise<void> {
    const profiles = call.request.profiles ?? [];

    const profilesByMap = profiles.map(it => {
      const item: ServiceProfileItem = {
        name: it.name!,
        type: it.type! as ServiceType
      };

      if (it.selector) {
        item.selector = pairsToMap(it.selector as NotNullableInterface<root.alice.IKeyValuePair>[]) as Record<'functionName', string>;
      }
      if (it.selectors) {
        item.selectors = it.selectors.map(it => {

          return {
            proportion: it.proportion || 0,
            selector: pairsToMap(it.selector as NotNullableInterface<root.alice.IKeyValuePair>[]) as Record<'functionName', string>
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

  async getServiceProfiles() : Promise<root.alice.data.IServiceProfilesAccessor> {
    let profiles = this.dataFlowController.serviceSelector.toJSON();

    const profilesAccessor: root.alice.data.IFunctionService[] = profiles.map(it => {
      const item: root.alice.data.IFunctionService = {
        name: it.name,
        type: it.type
      };

      if (it.selector) {
        item.selector = mapToPairs(it.selector as Record<'functionName', string>);
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
    return {
      profiles: profilesAccessor,
    };
  }

  /**
   * Set whether a function is using inspector (this is sent from SDK)
   */
  async useInspector(call: ServerUnaryCall<root.alice.data.IUseInspectorRequest>): Promise<void> {
    const { funcName, use } = call.request;
    rpcAssert(funcName != null);
    rpcAssert(use != null);
    const action = use ? 'open' : 'close';
    logger.info(`${action} '${funcName}' inspector.`);
    this.dataFlowController.useInspector(funcName, use);
  }

  /**
   * Set Dapr adapter
   */
  async setDaprAdaptor(call: ServerUnaryCall<root.alice.data.ISetDaprAdaptorRequest>) {
    const { modulePath } = call.request;
    rpcAssert(modulePath);
    let mod = null;

    try {
      logger.info('set dapr path', modulePath);
      const Clz = require(modulePath);

      mod = new Clz({
        logger: loggers.get('dapr'),
      });

      await mod.ready();
      this.dataFlowController.delegate.setDaprAdaptor(mod);
    } catch (e) {
      logger.error(e);

      if (mod?.close) {
        mod.close();
        mod = null;
      }

      throw e;
    }

    return {};
  }

  async setTracingCategories(call: ServerUnaryCall<root.alice.data.ISetTracingCategoriesRequest>): Promise<void> {
    const { functionName, inspect } = call.request;
    const categories = call.request.categories ?? [];
    rpcAssert(functionName);

    const broker = this.dataFlowController.getBroker(functionName, {
      inspect: !!inspect,
    });

    await Promise.all((broker?.workers ?? []).map(it => {
      if (categories.length > 0) {
        return it.delegate.tracingStart(it.credential, categories);
      } else {
        return it.delegate.tracingStop(it.credential);
      }
    }));
  }

  async startInspector(call: ServerUnaryCall<root.alice.data.IStartInspectorRequest>): Promise<void> {
    const { functionName, inspect } = call.request;
    rpcAssert(functionName);

    const broker = this.dataFlowController.getBroker(functionName, {
      inspect: !!inspect,
    });

    await Promise.all((broker?.workers ?? []).map(it => {
      it.delegate.inspectorStart(it.credential);
    }));
  }

  /**
   * Register worker credential
   */
  async registerWorkerCredential(call: ServerUnaryCall<root.alice.data.IRegisterWorkerCredentialRequest>) {
    const { funcName, processName, credential, inspect } = call.request;
    rpcAssert(funcName != null && processName != null  && credential != null && inspect != null );
    this.dataFlowController.registerWorkerCredential(funcName, processName, credential, { inspect: !!inspect });
    return {};
  }

  /**
   * Returns the server sock path
   * @return {Promise<import('#self/lib/proto/alice/data-panel').ServerSockPathResponse>} The result.
   */
  async serverSockPath() {
    return {
      path: this.dataFlowController.delegate.serverSockPath(),
    };
  }
}
