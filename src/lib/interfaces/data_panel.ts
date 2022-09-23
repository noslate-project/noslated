import * as root from '#self/proto/root';
import { ServerUnaryCall } from '../rpc/util';

export interface IDataPanel {

  startWorkerFastFail(call: ServerUnaryCall<root.alice.data.IStartWorkerFastFailRequest>): Promise<void>;

  reduceCapacity(call: ServerUnaryCall<root.alice.data.ICapacityReductionRequest>): Promise<root.alice.data.ICapacityReductionResponse>;

  setFunctionProfile(call: ServerUnaryCall<root.alice.ISetFunctionProfileRequest>):  Promise<root.alice.ISetFunctionProfileResponse>;

  setServiceProfiles(call: ServerUnaryCall<root.alice.data.IServiceProfilesAccessor>): Promise<void>;

  getServiceProfiles() : Promise<root.alice.data.IServiceProfilesAccessor>;

  useInspector(call: ServerUnaryCall<root.alice.data.IUseInspectorRequest>): Promise<void>;

  setDaprAdaptor(call: ServerUnaryCall<root.alice.data.ISetDaprAdaptorRequest>): Promise<{}>;

  setTracingCategories(call: ServerUnaryCall<root.alice.data.ISetTracingCategoriesRequest>): Promise<void>;

  startInspector(call: ServerUnaryCall<root.alice.data.IStartInspectorRequest>): Promise<void>;

  registerWorkerCredential(call: ServerUnaryCall<root.alice.data.IRegisterWorkerCredentialRequest>): Promise<{}>;

  serverSockPath(): Promise<root.alice.data.IServerSockPathResponse>;
}