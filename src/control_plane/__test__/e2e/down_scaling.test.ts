import * as common from '#self/test/common';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import assert from 'assert';
import { Readable } from 'stream';
import { WorkerTrafficStatsEvent } from '#self/control_plane/events';
import { findResponseHeaderValue } from '#self/test/util';
import { bufferFromStream } from '#self/lib/util';
import extend from 'extend';
import { TriggerResponse } from '#self/delegate/request_response';
import { WorkerStatus } from '#self/lib/constants';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const workerRedundantVictimSpareTimes = 2;
  const env = new DefaultEnvironment({
    config: common.extendDefaultConfig({
      controlPlane: {
        workerTrafficStatsPullingMs: 1000,
        workerRedundantVictimSpareTimes,
        /** always find a victim */
        capacityScalingStage: 2,
      },
    }),
  });

  const profile: AworkerFunctionProfile = {
    name: 'aworker_echo',
    runtime: 'aworker',
    url: `file://${baselineDir}/aworker_echo`,
    sourceFile: 'index.js',
    signature: 'md5:234234',
    worker: {
      maxActivateRequests: 1,
      /** ensures at least one worker is surviving. */
      reservationCount: 1,
    },
  };

  describe('lcc', () => {
    it('should down scale', async () => {
      await env.agent.setFunctionProfile([profile]);

      // Bootstrap two workers.
      const body1 = new Readable({ read() {} });
      const resp1 = await env.agent.invoke('aworker_echo', body1, {
        method: 'POST',
      });

      const body2 = new Readable({ read() {} });
      const resp2 = await env.agent.invoke('aworker_echo', body2, {
        method: 'POST',
      });
      const worker2 = getWorkerNameFromResponse(resp2);

      const stateManager = env.control['_stateManager'];
      const eventBus = env.control['_eventBus'];
      const broker = stateManager.getBroker('aworker_echo', false)!;
      assert.strictEqual(broker.activeWorkerCount, 2);

      // Finish the request 1.
      body1.push(null);
      await bufferFromStream(resp1);

      for (let i = 0; i < workerRedundantVictimSpareTimes; i++) {
        await eventBus.once(WorkerTrafficStatsEvent);
      }

      // Verify worker2 survived.
      assert.strictEqual(broker.activeWorkerCount, 1);
      assert.strictEqual(
        broker.getWorker(worker2)?.workerStatus,
        WorkerStatus.Ready
      );

      // Finish the request 2.
      body2.push(null);
      await bufferFromStream(resp2);
    });
  });

  describe('filo', () => {
    it('should down scale', async () => {
      await env.agent.setFunctionProfile([
        extend(true, profile, {
          worker: {
            shrinkStrategy: 'FILO',
          },
        }),
      ]);

      // Bootstrap two workers.
      const body1 = new Readable({ read() {} });
      const resp1 = await env.agent.invoke('aworker_echo', body1, {
        method: 'POST',
      });
      const worker1 = getWorkerNameFromResponse(resp1);

      const body2 = new Readable({ read() {} });
      const resp2 = await env.agent.invoke('aworker_echo', body2, {
        method: 'POST',
      });

      const stateManager = env.control['_stateManager'];
      const eventBus = env.control['_eventBus'];
      const broker = stateManager.getBroker('aworker_echo', false)!;
      assert.strictEqual(broker.activeWorkerCount, 2);

      // Finish the request 1.
      body1.push(null);
      await bufferFromStream(resp1);

      for (let i = 0; i < workerRedundantVictimSpareTimes - 1; i++) {
        await eventBus.once(WorkerTrafficStatsEvent);
      }
      const future = eventBus.once(WorkerTrafficStatsEvent);

      // Finish the request 2 to settle the WorkerTrafficStatsEvent.
      body2.push(null);
      await bufferFromStream(resp2);

      await future;

      // Verify worker1 survived even without active requests.
      assert.strictEqual(broker.activeWorkerCount, 1);
      assert.strictEqual(
        broker.getWorker(worker1)?.workerStatus,
        WorkerStatus.Ready
      );
    });
  });

  describe('fifo', () => {
    it('should down scale', async () => {
      await env.agent.setFunctionProfile([
        extend(true, profile, {
          worker: {
            shrinkStrategy: 'FIFO',
          },
        }),
      ]);

      // Bootstrap two workers.
      const body1 = new Readable({ read() {} });
      const resp1 = await env.agent.invoke('aworker_echo', body1, {
        method: 'POST',
      });

      const body2 = new Readable({ read() {} });
      const resp2 = await env.agent.invoke('aworker_echo', body2, {
        method: 'POST',
      });
      const worker2 = getWorkerNameFromResponse(resp2);

      const stateManager = env.control['_stateManager'];
      const eventBus = env.control['_eventBus'];
      const broker = stateManager.getBroker('aworker_echo', false)!;
      assert.strictEqual(broker.activeWorkerCount, 2);

      // Finish the request 2.
      body2.push(null);
      await bufferFromStream(resp2);

      for (let i = 0; i < workerRedundantVictimSpareTimes - 1; i++) {
        await eventBus.once(WorkerTrafficStatsEvent);
      }
      const future = eventBus.once(WorkerTrafficStatsEvent);

      // Finish the request 1 to settle the WorkerTrafficStatsEvent.
      body1.push(null);
      await bufferFromStream(resp1);

      await future;

      // Verify worker2 survived even without active requests.
      assert.strictEqual(broker.activeWorkerCount, 1);
      assert.strictEqual(
        broker.getWorker(worker2)?.workerStatus,
        WorkerStatus.Ready
      );
    });
  });
});

function getWorkerNameFromResponse(resp: TriggerResponse) {
  const workerName = findResponseHeaderValue(resp, 'x-noslate-worker-id');
  assert(workerName);
  return workerName;
}
