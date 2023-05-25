import { Metadata } from '#self/delegate/request_response';
import * as common from '#self/test/common';
import assert from 'assert';
import { TestDataWorker, TestDispatcherDelegate } from './test-util';
import { RoundRobinDispatcher } from '#self/data_plane/dispatcher/round_robin';
import _ from 'lodash';
import sinon from 'sinon';

describe(common.testName(__filename), () => {
  let delegate: TestDispatcherDelegate;
  let dispatcher: RoundRobinDispatcher;

  const maxActiveRequestCount = 10;
  beforeEach(() => {
    delegate = new TestDispatcherDelegate(maxActiveRequestCount);
    dispatcher = new RoundRobinDispatcher(delegate);
  });

  afterEach(() => {
    delegate.close();
    sinon.restore();
  });

  describe('_getNextWorker', () => {
    it('no worker', async () => {
      assert.ok(dispatcher._getNextWorker() == null);
    });

    it('1 worker', async () => {
      const worker = new TestDataWorker();
      dispatcher.registerWorker(worker);
      assert.strictEqual(dispatcher._getNextWorker(), worker);
      assert.strictEqual(dispatcher._getNextWorker(), worker);
      assert.strictEqual(dispatcher._getNextWorker(), worker);
    });

    it('queue new workers', async () => {
      const workers = _.times(4).map(() => new TestDataWorker());
      _.times(2).forEach(idx => {
        dispatcher.registerWorker(workers[idx]);
      });

      // Queue: 0, 1
      assert.strictEqual(dispatcher._getNextWorker(), workers[0]);

      dispatcher.registerWorker(workers[2]);
      // Queue: 1, 0, 2
      assert.strictEqual(dispatcher._getNextWorker(), workers[1]);
      assert.strictEqual(dispatcher._getNextWorker(), workers[0]);
      assert.strictEqual(dispatcher._getNextWorker(), workers[2]);
    });
  });

  describe('tryConsumeQueue', () => {
    it('should drain request queue', async () => {
      _.times(5).map(async () => {
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
      dispatcher.registerWorker(worker);
      assert.strictEqual(delegate.pendingRequestList.length, 0);
    });

    it('should yield when worker active request count reaches batch size', async () => {
      const clock = sinon.useFakeTimers({
        shouldAdvanceTime: false,
      });
      dispatcher = new RoundRobinDispatcher(delegate, {
        batchSize: 2,
      });

      _.times(5).map(async () => {
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
      dispatcher.registerWorker(worker);
      assert.strictEqual(delegate.pendingRequestList.length, 3);

      clock.tick(1);
      assert.strictEqual(delegate.pendingRequestList.length, 1);

      clock.tick(1);
      assert.strictEqual(delegate.pendingRequestList.length, 0);
    });

    it('should yield when dispatcher concurrency reaches limit', async () => {
      const clock = sinon.useFakeTimers({
        shouldAdvanceTime: false,
      });
      dispatcher = new RoundRobinDispatcher(delegate, {
        maxConcurrency: 2,
      });

      const responseFutures = _.times(5).map(async () => {
        const resp = await dispatcher.invoke(
          Buffer.from('ok'),
          new Metadata({
            method: 'POST',
          })
        );
        // Drain the response data.
        resp.on('data', () => {});
        resp.on('end', () => {});

        return resp;
      });
      assert.strictEqual(delegate.pendingRequestList.length, 5);

      const worker1 = new TestDataWorker();
      dispatcher.registerWorker(worker1);
      // worker1 consumes 2 concurrent request at once.
      assert.strictEqual(delegate.pendingRequestList.length, 3);

      const worker2 = new TestDataWorker();
      dispatcher.registerWorker(worker2);
      // worker2 consumes no request as the concurrency reached the limit.
      assert.strictEqual(delegate.pendingRequestList.length, 3);

      // Ticking the clock doesn't consume the queue.
      clock.tick(1);
      assert.strictEqual(delegate.pendingRequestList.length, 3);

      const resp1 = await responseFutures[0];
      resp1.push(null);
      await resp1.finish();
      await clock.tickAsync(1);
      // Req1 finished, worker2 takes the next request.
      assert.strictEqual(delegate.pendingRequestList.length, 2);

      const resp2 = await responseFutures[1];
      resp2.push(null);
      await resp2.finish();
      await clock.tickAsync(1);
      // Req2 finished, worker1 takes the next request.
      assert.strictEqual(delegate.pendingRequestList.length, 1);

      const resp3 = await responseFutures[2];
      resp3.push(null);
      await resp3.finish();
      await clock.tickAsync(1);
      // Req3 finished, worker2 takes the next request.
      assert.strictEqual(delegate.pendingRequestList.length, 0);

      assert.strictEqual(worker1.activeRequestCount, 1);
      assert.strictEqual(worker2.activeRequestCount, 1);
    });
  });
});
