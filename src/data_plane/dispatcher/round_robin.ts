import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { DataWorker, Dispatcher, DispatcherDelegate } from './dispatcher';
import { List, ReadonlyNode } from '#self/lib/list';

export interface RoundRobinDispatcherOptions {
  /**
   * Batch size of requests being processed in a single loop.
   *
   * @default 25
   */
  batchSize?: number;
  /**
   * Concurrency limit for the dispatcher.
   *
   * Defaults to `maxActiveRequestCount * replicaCountLimit`.
   */
  maxConcurrency?: number;
}

export class RoundRobinDispatcher implements Dispatcher {
  type = 'round-robin';

  private _workers = new List<DataWorker>();
  private readonly _batchSize: number;
  private readonly _maxConcurrency: number;
  private _concurrency = 0;

  constructor(
    private _delegate: DispatcherDelegate,
    options?: RoundRobinDispatcherOptions
  ) {
    this._batchSize = options?.batchSize ?? 25;
    this._maxConcurrency =
      options?.maxConcurrency ??
      this._delegate.maxActiveRequestCount * this._delegate.replicaCountLimit;
  }

  _getNextWorker(): DataWorker | undefined {
    while (this._workers.length) {
      const worker = this._workers.shift()!;
      if (worker.trafficOff) {
        continue;
      }
      // Queue the worker again.
      const node = this._workers.push(worker);
      worker.setDispatcherData(node);
      return worker;
    }
  }

  _unshiftWorker(worker: DataWorker) {
    let node = worker.getDispatcherData<ReadonlyNode<DataWorker>>();
    if (node) {
      this._workers.remove(node);
    }
    node = this._workers.unshift(worker);
    worker.setDispatcherData(node);
  }

  /**
   * Try consume the pending request queue.
   * @param worker The idled (not that busy) worker.
   */
  _tryConsumeQueue() {
    let count = 0;
    let worker = this._getNextWorker();
    if (worker == null) {
      return;
    }

    while (
      this._delegate.getPendingRequestCount() &&
      this._concurrency < this._maxConcurrency
    ) {
      // Use the last worker if it is not consumed.
      if (worker == null) {
        worker = this._getNextWorker();
      }
      if (worker == null) {
        break;
      }

      const request = this._delegate.getPendingRequest();
      if (!request) continue;
      if (!request.available) continue;
      request.stopTimer();

      this._concurrency++;
      const future = worker.invoke(request);
      this._handleResponse(future);
      future.then(request.resolve, request.reject);

      count++;
      worker = undefined;

      // TODO: better way to yield.
      if (count >= this._batchSize) {
        setTimeout(() => {
          this._tryConsumeQueue();
        }, 1);
        break;
      }
    }

    // Put the worker back to the queue if it is not consumed.
    if (worker) {
      this._unshiftWorker(worker);
    }
  }

  private _handleResponse(future: Promise<TriggerResponse>) {
    future
      .then(
        res => {
          return res.finish();
        },
        () => {}
      )
      .finally(() => {
        this._concurrency--;
        this._tryConsumeQueue();
      });
  }

  private _queueRequest(
    input: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse> {
    this._delegate.checkRequestQueueing(metadata);
    const pendingRequest = this._delegate.createPendingRequest(input, metadata);
    return pendingRequest.promise;
  }

  async invoke(
    input: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse> {
    if (
      this._delegate.getPendingRequestCount() ||
      this._concurrency >= this._maxConcurrency
    ) {
      return this._queueRequest(input, metadata);
    }

    const worker = this._getNextWorker();
    if (worker == null) {
      return this._queueRequest(input, metadata);
    }

    this._concurrency++;
    const future = worker.invoke(input, metadata);
    this._handleResponse(future);
    return future;
  }

  registerWorker(worker: DataWorker) {
    const node = this._workers.push(worker);
    worker.setDispatcherData(node);

    this._tryConsumeQueue();
  }

  unregisterWorker(worker: DataWorker) {
    const node = worker.getDispatcherData<ReadonlyNode<DataWorker>>();
    if (node) {
      this._workers.remove(node);
    }
  }
}
