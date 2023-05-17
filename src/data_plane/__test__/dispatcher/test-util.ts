import {
  DataWorker,
  DispatcherDelegate,
} from '#self/data_plane/dispatcher/dispatcher';
import { PendingRequest } from '#self/data_plane/worker_broker';
import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { List } from '#self/lib/list';
import { loggers } from '#self/lib/loggers';
import { Readable } from 'stream';

const logger = loggers.get('test');

export class TestDispatcherDelegate implements DispatcherDelegate {
  pendingRequestList = new List<PendingRequest>();

  constructor(public maxActiveRequestCount: number = 1) {}

  checkRequestQueueing(): void {
    return;
  }
  createPendingRequest(
    input: Readable | Buffer,
    metadata: Metadata
  ): PendingRequest {
    logger.debug('create pending request');
    const pendingRequest = new PendingRequest(
      input,
      metadata,
      10_000 + Date.now()
    );
    this.pendingRequestList.push(pendingRequest);
    return pendingRequest;
  }

  getPendingRequestCount(): number {
    return this.pendingRequestList.length;
  }
  getPendingRequest(): PendingRequest | undefined {
    return this.pendingRequestList.shift();
  }

  closeTraffic(worker: TestDataWorker): void {
    logger.debug('close traffic of worker', worker.name);
    worker.trafficOff = true;
  }

  close() {
    while (this.pendingRequestList.length) {
      const req = this.pendingRequestList.shift()!;
      req.stopTimer();
    }
  }
}

let id = 0;
export class TestDataWorker implements DataWorker {
  name = `test-worker-${id++}`;
  activeRequestCount = 0;
  trafficOff = false;

  dispatcherData: unknown;

  getDispatcherData<T>(): T {
    return this.dispatcherData as T;
  }
  setDispatcherData<T>(val: T): void {
    this.dispatcherData = val;
  }

  invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse>;
  invoke(request: PendingRequest): Promise<TriggerResponse>;
  async invoke(): Promise<TriggerResponse> {
    this.activeRequestCount++;
    const response = new TriggerResponse({
      status: 200,
      read: () => {},
      destroy: (err, cb) => {
        cb(err);
      },
    });
    response.on('close', () => {
      this.activeRequestCount--;
    });
    return response;
  }
}
