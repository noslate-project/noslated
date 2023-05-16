import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { DataWorker, Dispatcher, DispatcherDelegate } from './dispatcher';
import { List, ReadonlyNode } from '#self/lib/list';

export class DisposableDispatcher implements Dispatcher {
  type = 'disposable';

  _workers = new List<DataWorker>();

  constructor(private _delegate: DispatcherDelegate) {}

  private _handleResponse(
    worker: DataWorker,
    future: Promise<TriggerResponse>
  ) {
    future
      .then(res => res.finish())
      .then(
        () => {
          this._delegate.closeTraffic(worker);
        },
        () => {
          this._delegate.closeTraffic(worker);
        }
      );
  }

  invoke(
    inputStream: Readable | Buffer,
    metadata: Metadata
  ): Promise<TriggerResponse> {
    const worker = this._workers.shift();
    if (worker) {
      const future = worker.invoke(inputStream, metadata);
      this._handleResponse(worker, future);
      return future;
    }

    const pendingRequest = this._delegate.createPendingRequest(
      inputStream,
      metadata
    );
    return pendingRequest.promise;
  }

  registerWorker(worker: DataWorker) {
    const pendingRequest = this._delegate.getPendingRequest();
    if (pendingRequest == null) {
      const node = this._workers.push(worker);
      worker.setDispatcherData(node);
      return;
    }
    pendingRequest.stopTimer();
    const future = worker.invoke(pendingRequest);
    this._handleResponse(worker, future);
    future.then(
      res => {
        pendingRequest.resolve(res);
      },
      err => {
        pendingRequest.reject(err);
      }
    );
  }

  unregisterWorker(worker: DataWorker) {
    const node: ReadonlyNode<DataWorker> | undefined =
      worker.getDispatcherData();
    if (node) {
      this._workers.remove(node);
    }
  }
}
