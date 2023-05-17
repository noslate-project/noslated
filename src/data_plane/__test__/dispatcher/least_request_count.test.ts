import { Metadata } from '#self/delegate/request_response';
import * as common from '#self/test/common';
import assert from 'assert';
import { TestDataWorker, TestDispatcherDelegate } from './test-util';
import { bufferFromStream } from '#self/lib/util';
import { LeastRequestCountDispatcher } from '#self/data_plane/dispatcher/least_request_count';
import _ from 'lodash';

describe(common.testName(__filename), () => {
  let delegate: TestDispatcherDelegate;
  let dispatcher: LeastRequestCountDispatcher;

  const maxActiveRequestCount = 10;
  beforeEach(() => {
    delegate = new TestDispatcherDelegate(maxActiveRequestCount);
    dispatcher = new LeastRequestCountDispatcher(delegate);
  });

  afterEach(() => {
    delegate.close();
  });

  describe('getAvailableWorker', () => {
    it('no worker', async () => {
      assert.ok(dispatcher._getAvailableWorker() == null);
    });

    it("worker's traffic has been closed", async () => {
      _.times(2)
        .map(() => new TestDataWorker())
        .forEach(it => {
          dispatcher.registerWorker(it);
          delegate.closeTraffic(it);
        });

      assert.ok(dispatcher._getAvailableWorker() == null);
    });

    it('no `traffic on` worker and idle worker', async () => {
      _.times(2)
        .map(() => new TestDataWorker())
        .forEach(it => {
          dispatcher.registerWorker(it);
          delegate.closeTraffic(it);
        });

      const worker = new TestDataWorker();
      worker.activeRequestCount = 1;
      dispatcher.registerWorker(worker);

      assert.strictEqual(dispatcher._getAvailableWorker(), worker);
    });

    it('return idlest worker', async () => {
      // activeRequestCount: [10, 9, 8, 7]
      const workers = _.times(3).map(() => new TestDataWorker());
      workers.forEach((it, idx) => {
        dispatcher.registerWorker(it);
        delegate.closeTraffic(it);
        it.activeRequestCount = 10 - idx;
      });

      assert.strictEqual(dispatcher._getAvailableWorker(), workers[3]);
    });
  });

  describe('_tryConsumeQueue', () => {
    it('should drain request queue', async () => {
      const requestFutures = _.times(5).map(async () => {
        const resp = await dispatcher.invoke(
          Buffer.from('ok'),
          new Metadata({
            method: 'POST',
          })
        );

        // end the stream.
        resp.push(null);
      });
      assert.strictEqual(delegate.pendingRequestList.length, 5);

      const worker = new TestDataWorker();
      dispatcher._tryConsumeQueue(worker);

      await requestFutures[4];

      assert.strictEqual(delegate.pendingRequestList.length, 0);
    });

    it('should not continue processing request when worker traffic is off', async () => {
      delegate.maxActiveRequestCount = 1;
      const requestFutures = _.times(5).map(async idx => {
        const resp = await dispatcher.invoke(
          Buffer.from('ok'),
          new Metadata({
            method: 'POST',
          })
        );

        if (idx === 2) {
          delegate.closeTraffic(worker);
        }

        // end the stream.
        resp.push(null);
        await bufferFromStream(resp);
      });
      assert.strictEqual(delegate.pendingRequestList.length, 5);

      const worker = new TestDataWorker();
      dispatcher._tryConsumeQueue(worker);

      await requestFutures[2];
      assert.strictEqual(worker.trafficOff, true);
      assert.strictEqual(delegate.pendingRequestList.length, 2);

      // Call the function again doesn't process the request queue.
      dispatcher._tryConsumeQueue(worker);
      assert.strictEqual(delegate.pendingRequestList.length, 2);
    });
  });

  describe('passthrough', () => {
    it('should process request when worker is available', async () => {
      const worker = new TestDataWorker();
      dispatcher.registerWorker(worker);

      const respFuture = dispatcher.invoke(
        Buffer.from('ok'),
        new Metadata({
          method: 'POST',
        })
      );
      // No queued requests.
      assert.strictEqual(delegate.pendingRequestList.length, 0);
      assert.strictEqual(worker.activeRequestCount, 1);

      const resp = await respFuture;
      resp.push(null);
      await bufferFromStream(resp);
      assert.strictEqual(worker.activeRequestCount, 0);
    });
  });

  describe('register/unregister', () => {
    it('should unregister worker', async () => {
      assert.strictEqual(dispatcher._workerHeap.length, 0);

      const worker = new TestDataWorker();
      dispatcher.registerWorker(worker);
      assert.strictEqual(dispatcher._workerHeap.length, 1);

      dispatcher.unregisterWorker(worker);
      assert.strictEqual(dispatcher._workerHeap.length, 0);
    });
  });
});
