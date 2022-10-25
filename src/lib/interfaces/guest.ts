import * as root from '#self/proto/root';
import { Client, ClientDuplexStream } from '@grpc/grpc-js';

export interface IHostClient extends Client {
  connect(): ClientDuplexStream<root.noslated.IRequest, root.noslated.ISubscriptionChunk>;
}
