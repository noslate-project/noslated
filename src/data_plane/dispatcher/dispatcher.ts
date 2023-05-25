import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { PendingRequest } from '../worker_broker';

export interface DataWorker {
  readonly name: string;
  readonly activeRequestCount: number;
  readonly trafficOff: boolean;

  getDispatcherData<T>(): T;
  setDispatcherData<T>(val: T): void;

  invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse>;
  invoke(request: PendingRequest): Promise<TriggerResponse>;
}

export interface DispatcherDelegate {
  readonly maxActiveRequestCount: number;
  readonly replicaCountLimit: number;

  checkRequestQueueing(metadata: Metadata): void;
  createPendingRequest(
    input: Readable | Buffer,
    metadata: Metadata
  ): PendingRequest;

  getPendingRequestCount(): number;
  getPendingRequest(): PendingRequest | undefined;

  closeTraffic(worker: DataWorker): void;
}

export interface Dispatcher {
  readonly type: string;

  invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse>;

  registerWorker(worker: DataWorker): void;
  unregisterWorker(worker: DataWorker): void;
}
