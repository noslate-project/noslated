import * as root from '#self/proto/root';
import { Client, ClientDuplexStream } from '@grpc/grpc-js';

export interface IHostClient extends Client {
  connect(): ClientDuplexStream<root.alice.IRequest, root.alice.ISubscriptionChunk>;
}