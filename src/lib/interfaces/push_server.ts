import { ServerDuplexStream } from '@grpc/grpc-js';
import * as root from '#self/proto/root';

export interface IPushServer {
  invoke(
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): void;

  invokeService(
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): void;
}
