import assert from 'assert';
import mm from 'mm';
import * as common from '#self/test/common';
import { createDeferred } from '#self/lib/util';
import { daemonProse, ProseContext } from '#self/test/util';
import { turf, TurfContainerStates } from '#self/lib/turf';
import { Host } from '#self/lib/rpc/host';
import { performance } from 'perf_hooks';
import { ContainerStatusReport } from '#self/lib/constants';

/**
 * Wait for at least one subscriber for a host object with subscribe event name.
 * @param {import('#self/lib/rpc/host').Host} host The host object.
 * @param {string} name The subscribe event name.
 * @return {Promise<void>} The result.
 */
function waitForAtLeastOneSubscriber(host: Host, name: string) {
  if (host.getSubscribers('workerTrafficStats')?.length) {
    return;
  }

  const { promise, resolve } = createDeferred<void>();

  const listner = (_name: string) => {
    if (_name === name) {
      host.removeListener('new-subscriber', listner);
      resolve();
    }
  };

  host.on('new-subscriber', listner);

  return promise;
}

describe(common.testName(__filename), () => {
  const roles: ProseContext = {};
  daemonProse(roles);

  describe('workerTrafficStats', () => {
    const profiles = [{
      name: 'func',
      url: `file://${__dirname}`,
      runtime: 'aworker' as const,
      signature: 'xxx',
      sourceFile: 'index.js',
      worker: {
        replicaCountLimit: 10,
      },
      resourceLimit: {
        memory: 123456,
      },
    }, {
      name: 'lambda',
      url: `file://${__dirname}`,
      runtime: 'aworker' as const,
      signature: 'xxx',
      sourceFile: 'index.js',
    }];

    it('should sync', async function() {
      this.timeout(10000);
      const brokerData = {
        functionName: 'func',
        inspector: false,
        workers: [{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 6,
        }],
      };

      const { functionProfile, capacityManager } = roles.control!;
      functionProfile.set(profiles, 'WAIT');

      const { promise: promise1, resolve: resolve1 } = createDeferred<void>();
      functionProfile.once('changed', () => {
        resolve1();
      });
      await promise1;

      capacityManager.workerStatsSnapshot.register('func', 'hello', 'world', false);
      capacityManager.workerStatsSnapshot.register('func', 'foo', 'bar', false);

      const { promise: promise2, resolve: resolve2 } = createDeferred<void>();
      const syncWorkerData = capacityManager.syncWorkerData.bind(capacityManager);
      const autoScale = capacityManager.autoScale.bind(capacityManager);
      let syncWorkerDataCalled = 0;
      let autoScaleCalled = 0;
      mm(capacityManager, 'syncWorkerData', async (brokers: any) => {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(brokers)), [ brokerData ]);
        syncWorkerDataCalled++;
        return syncWorkerData(brokers);
      });
      mm(capacityManager, 'autoScale', async () => {
        autoScaleCalled++;
        const ret = await autoScale();
        resolve2();
        return ret;
      });

      await waitForAtLeastOneSubscriber(roles.data!.dataFlowController.host, 'workerTrafficStats');
      await (roles.data!.dataFlowController.host as any).broadcastWorkerTrafficStats({ brokers: [ brokerData ] });
      await promise2;

      assert.strictEqual(syncWorkerDataCalled, 1);
      assert.strictEqual(autoScaleCalled, 1);
    });

    it('should catch throw', async function() {
      this.timeout(10000);
      const brokerData = {
        functionName: 'func',
        inspector: false,
        workers: [{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 10,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 10,
        }],
      };

      const { functionProfile, capacityManager } = roles.control!;
      functionProfile.set(profiles, 'WAIT');

      const { promise: promise1, resolve: resolve1 } = createDeferred<void>();
      functionProfile.once('changed', () => {
        resolve1();
      });
      await promise1;

      capacityManager.workerStatsSnapshot.register('func', 'hello', 'world', false);
      capacityManager.workerStatsSnapshot.register('func', 'foo', 'bar', false);

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'hello',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: ''
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'foo',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: ''
      });

      const { promise: promise2, resolve: resolve2 } = createDeferred<void>();
      const syncWorkerData = capacityManager.syncWorkerData.bind(capacityManager);
      const autoScale = capacityManager.autoScale.bind(capacityManager);
      let syncWorkerDataCalled = 0;
      let autoScaleCalled = 0;
      mm(capacityManager, 'syncWorkerData', async (brokers: any) => {
        assert.deepStrictEqual(JSON.parse(JSON.stringify(brokers)), [ brokerData ]);
        syncWorkerDataCalled++;
        return syncWorkerData(brokers);
      });
      mm(capacityManager, 'autoScale', async () => {
        autoScaleCalled++;
        try {
          await autoScale();
        } catch (e) {
          assert(/Invalid runtime hello\./.test((e as Error).message));
          resolve2();
          throw e;
        }
      });
      mm(turf, 'ps', async () => {
        return [{ name: 'foo', pid: 10000, status: TurfContainerStates.running }];
      });

      await waitForAtLeastOneSubscriber(roles.data!.dataFlowController.host, 'workerTrafficStats');
      functionProfile.profile[0].runtime = 'hello' as any;
      await (roles.data!.dataFlowController.host as any).broadcastWorkerTrafficStats({ brokers: [ brokerData ] });
      await promise2;

      assert.strictEqual(syncWorkerDataCalled, 1);
      assert.strictEqual(autoScaleCalled, 1);
    });
  });
});
