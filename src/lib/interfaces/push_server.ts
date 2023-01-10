import { ServerWritableStream } from '@grpc/grpc-js';
import * as root from '#self/proto/root';
import { KVPairs } from '../rpc/key_value_pair';

export interface IPushServer {
  invoke(
    call: ServerWritableStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<InvokeResponse>;

  invokeService(
    call: ServerWritableStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<InvokeResponse>;
}

export interface InvokeResponse {
  result?: {
    status: number;
    body: Buffer;
    headers: KVPairs;
  };
  error?: unknown;
}
