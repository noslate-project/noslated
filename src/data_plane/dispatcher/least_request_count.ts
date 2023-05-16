import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { DataWorker, Dispatcher, DispatcherDelegate } from './dispatcher';
import { MinHeap } from '@datastructures-js/heap';

export enum RequestQueueStatus {
  kPassThrough = 0,
  kQueueing = 1,
}

export class LeastRequestCountDispatcher implements Dispatcher {
  type = 'least-request-count';

  _workerHeap: DataWorker[] = [];
  _requestQueueStatus: RequestQueueStatus = RequestQueueStatus.kPassThrough;

  constructor(private _delegate: DispatcherDelegate) {}

  _getAvailableWorker(): DataWorker | undefined {
    MinHeap.heapify(this._workerHeap, it =>
      it.trafficOff ? Infinity : it.activeRequestCount
    );
    const worker = this._workerHeap[0];
    if (worker && this._isWorkerFree(worker)) {
      return worker;
    }
  }

  protected _isWorkerFree(worker: DataWorker): boolean {
    return (
      !worker.trafficOff &&
      worker.activeRequestCount < this._delegate.maxActiveRequestCount
    );
  }

  /**
   * Try consume the pending request queue.
   * @param worker The idled (not that busy) worker.
   */
  _tryConsumeQueue(worker: DataWorker) {
    while (this._delegate.getPendingRequestCount()) {
      if (!this._isWorkerFree(worker)) {
        break;
      }

      const request = this._delegate.getPendingRequest();
      if (!request) continue;
      if (!request.available) continue;
      request.stopTimer();

      const future = worker.invoke(request);
      this._handleResponse(worker, future);
      future.then(request.resolve, request.reject);
    }

    if (this._delegate.getPendingRequestCount() === 0) {
      this._requestQueueStatus = RequestQueueStatus.kPassThrough;
    }
  }

  private _queueRequest(inputStream: Readable | Buffer, metadata: Metadata) {
    this._delegate.checkRequestQueueing(metadata);

    this._requestQueueStatus = RequestQueueStatus.kQueueing;
    const request = this._delegate.createPendingRequest(inputStream, metadata);
    return request.promise;
  }

  private _handleResponse(
    worker: DataWorker,
    future: Promise<TriggerResponse>
  ) {
    future
      .then(
        res => {
          return res.finish();
        },
        () => {}
      )
      .finally(() => {
        this._tryConsumeQueue(worker);
      });
  }

  async invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse> {
    switch (this._requestQueueStatus) {
      case RequestQueueStatus.kQueueing: {
        return this._queueRequest(inputStream, metadata);
      }

      case RequestQueueStatus.kPassThrough: {
        const worker = this._getAvailableWorker();
        if (worker == null) {
          return this._queueRequest(inputStream, metadata);
        }

        const future = worker.invoke(inputStream, metadata);
        this._handleResponse(worker, future);
        return future;
      }

      default: {
        throw new Error(
          `Request queue status ${this._requestQueueStatus} unreachable.`
        );
      }
    }
  }

  registerWorker(worker: DataWorker) {
    this._workerHeap.push(worker);
    this._tryConsumeQueue(worker);
  }

  unregisterWorker(worker: DataWorker) {
    const idx = this._workerHeap.indexOf(worker);
    if (idx >= 0) {
      this._workerHeap.splice(idx, 1);
    }
  }
}
