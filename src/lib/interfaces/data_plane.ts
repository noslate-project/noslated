import * as root from '#self/proto/root';
import { ServerUnaryCall } from '../rpc/util';

export interface IDataPlane {
  startWorkerFastFail(
    call: ServerUnaryCall<root.noslated.data.IStartWorkerFastFailRequest>
  ): Promise<void>;

  reduceCapacity(
    call: ServerUnaryCall<root.noslated.data.ICapacityReductionRequest>
  ): Promise<root.noslated.data.ICapacityReductionResponse>;

  setFunctionProfile(
    call: ServerUnaryCall<root.noslated.ISetFunctionProfileRequest>
  ): Promise<root.noslated.ISetFunctionProfileResponse>;

  setServiceProfiles(
    call: ServerUnaryCall<root.noslated.data.IServiceProfilesAccessor>
  ): Promise<void>;

  getServiceProfiles(): Promise<root.noslated.data.IServiceProfilesAccessor>;

  useInspector(
    call: ServerUnaryCall<root.noslated.data.IUseInspectorRequest>
  ): Promise<void>;

  setTracingCategories(
    call: ServerUnaryCall<root.noslated.data.ISetTracingCategoriesRequest>
  ): Promise<void>;

  startInspector(
    call: ServerUnaryCall<root.noslated.data.IStartInspectorRequest>
  ): Promise<void>;

  registerWorkerCredential(
    call: ServerUnaryCall<root.noslated.data.IRegisterWorkerCredentialRequest>
  ): Promise<unknown>;

  serverSockPath(): Promise<root.noslated.data.IServerSockPathResponse>;
}
