import { DisposableDispatcher } from '#self/data_plane/dispatcher/disposable';
import { Metadata } from '#self/delegate/request_response';
import * as common from '#self/test/common';
import assert from 'assert';
import { TestDataWorker, TestDispatcherDelegate } from './test-util';
import { bufferFromStream } from '#self/lib/util';
import sinon from 'sinon';

describe(common.testName(__filename), () => {
  it('should close traffic once request is handled', async () => {
    const delegate = new TestDispatcherDelegate();
    const dispatcher = new DisposableDispatcher(delegate);

    const respFuture = dispatcher.invoke(Buffer.from(''), new Metadata({}));
    assert.strictEqual(delegate.pendingRequestList.length, 1);

    const worker = new TestDataWorker();
    dispatcher.registerWorker(worker);
    const resp = await respFuture;
    // the request queue should have been drained.
    assert.strictEqual(delegate.pendingRequestList.length, 0);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(worker.trafficOff, false);

    // end the stream.
    resp.push(null);
    await bufferFromStream(resp);
    await resp.finish();
    assert.strictEqual(worker.trafficOff, true);
  });

  it('should close traffic when request is failed', async () => {
    const delegate = new TestDispatcherDelegate();
    const dispatcher = new DisposableDispatcher(delegate);

    const respFuture = dispatcher.invoke(Buffer.from(''), new Metadata({}));
    assert.strictEqual(delegate.pendingRequestList.length, 1);

    const worker = new TestDataWorker();
    sinon.stub(worker, 'invoke').rejects(new Error('mocked'));

    dispatcher.registerWorker(worker);
    await assert.rejects(respFuture, /mocked/);
    // the request queue should have been drained.
    assert.strictEqual(delegate.pendingRequestList.length, 0);
    assert.strictEqual(worker.trafficOff, true);
  });

  it('should close traffic when response is failed', async () => {
    const delegate = new TestDispatcherDelegate();
    const dispatcher = new DisposableDispatcher(delegate);

    const respFuture = dispatcher.invoke(Buffer.from(''), new Metadata({}));
    assert.strictEqual(delegate.pendingRequestList.length, 1);

    const worker = new TestDataWorker();
    dispatcher.registerWorker(worker);
    const resp = await respFuture;
    // the request queue should have been drained.
    assert.strictEqual(delegate.pendingRequestList.length, 0);
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(worker.trafficOff, false);

    // end the stream.
    resp.destroy(new Error('mocked'));
    await assert.rejects(bufferFromStream(resp), /mocked/);
    assert.strictEqual(worker.trafficOff, true);
  });

  it('should not queue request when worker is available', async () => {
    const delegate = new TestDispatcherDelegate();
    const dispatcher = new DisposableDispatcher(delegate);

    const worker = new TestDataWorker();
    dispatcher.registerWorker(worker);
    assert.strictEqual(dispatcher._workers.length, 1);

    const respFuture = dispatcher.invoke(Buffer.from(''), new Metadata({}));
    assert.strictEqual(delegate.pendingRequestList.length, 0);

    const resp = await respFuture;
    assert.strictEqual(resp.status, 200);
    assert.strictEqual(worker.trafficOff, false);

    // end the stream.
    resp.push(null);
    await bufferFromStream(resp);
    await resp.finish();
    assert.strictEqual(worker.trafficOff, true);
  });

  it('should unregister worker', async () => {
    const delegate = new TestDispatcherDelegate();
    const dispatcher = new DisposableDispatcher(delegate);

    const worker = new TestDataWorker();
    dispatcher.registerWorker(worker);
    assert.strictEqual(dispatcher._workers.length, 1);

    dispatcher.unregisterWorker(worker);
    assert.strictEqual(dispatcher._workers.length, 0);
  });
});
