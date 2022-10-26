import path from 'path';
import * as fs from 'fs';
import assert from 'assert';
import { performance } from 'perf_hooks';

import mm from 'mm';
import _ from 'lodash';
import FakeTimers, { Clock } from '@sinonjs/fake-timers';

import { NoslatedClient } from '#self/sdk';
import * as common from '#self/test/common';
import { DataPlane } from '#self/data_plane';
import { createDeferred } from '#self/lib/util';
import { ControlPlane } from '#self/control_plane/index';
import { startTurfD, stopTurfD, turf } from '#self/lib/turf';
import * as starters from '#self/control_plane/starter/index';
import { FIXTURES_DIR, Roles, startAllRoles } from '#self/test/util';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';

const simpleSandbox = path.resolve(FIXTURES_DIR, 'sandbox_simple');

describe(common.testName(__filename), () => {
  let stateManager: StateManager;
  let capacityManager: CapacityManager;
  let clock: Clock;

  let agent: NoslatedClient;
  let controlPlane: ControlPlane;
  let data: DataPlane;

  beforeEach(async () => {
    const roles = await startAllRoles() as Required<Roles>;

    data = roles.data;
    agent = roles.agent;
    controlPlane = roles.control;

    ({ stateManager, capacityManager } = controlPlane);
    ({ capacityManager } = controlPlane);

    clock = FakeTimers.install({
      toFake: ['setTimeout']
    });

    startTurfD();
  });

  afterEach(async () => {
    clock.uninstall();
    await Promise.all([
      controlPlane.close(),
      agent.close(),
      data.close()
    ]);
    await turf.destroyAll();

    stopTurfD();
  });

  describe('updateContainerStatusByReport()', () => {
    it('should update regularly', async () => {
      await agent.setFunctionProfile([{
        name: 'func1',
        url: `file://${__dirname}`,
        runtime: 'aworker',
        signature: 'xxx',
        sourceFile: 'index.js',
      }, {
        name: 'func2',
        url: `file://${__dirname}`,
        runtime: 'aworker',
        signature: 'xxx',
        sourceFile: 'index.js',
      }], 'WAIT');

      controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'cred1', false);
      controlPlane.capacityManager.workerStatsSnapshot.register('func2', 'worker1', 'cred1', false);

      const worker1 = capacityManager.workerStatsSnapshot.getWorker('func1', false, 'worker1');
      const worker2 = capacityManager.workerStatsSnapshot.getWorker('func2', false, 'worker1');

      assert(worker1);
      assert(worker2);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: ''
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Ready);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.RequestDrained,
        requestId: ''
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerDisconnected,
        requestId: ''
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: 'Unknown state',
        requestId: ''
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func2',
        name: 'worker1',
        isInspector: false,
        event: 'Unknown state',
        requestId: ''
      });

      stateManager.updateContainerStatusByReport({
        functionName: 'func2',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerDisconnected,
        requestId: ''
      });


      assert.strictEqual(worker2.containerStatus, ContainerStatus.Unknown);
    });


    it('should not update with illegal ContainerStatusReport order', async () => {
      const { functionProfileManager } = capacityManager;
      await agent.setFunctionProfile([{
        name: 'func1',
        url: `file://${__dirname}`,
        runtime: 'aworker',
        signature: 'xxx',
        sourceFile: 'index.js',
      }], 'WAIT');

      controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'cred1', false);

      const worker = capacityManager.workerStatsSnapshot.getWorker('func1', false, 'worker1');

      assert(worker);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.RequestDrained,
        requestId: ''
      });

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: ''
      });

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });
  });


  describe('syncWorkerData()', () => {
    it('should sync', async () => {
      await agent.setFunctionProfile([{
        name: 'func1',
        url: `file://${__dirname}`,
        runtime: 'aworker',
        signature: 'xxx',
        sourceFile: 'index.js',
      }], 'WAIT');

      const brokerStat1 = {
        functionName: 'func1',
        inspector: false,
        workers: [{
          name: 'worker1',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }, {
          name: 'worker2',
          maxActivateRequests: 10,
          activeRequestCount: 6,
        }],
      };

      controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'id1', false);
      controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker2', 'id2', false);

      await turf.create('worker1', simpleSandbox);
      await turf.create('worker2', simpleSandbox);
      await turf.start('worker1');
      await turf.start('worker2');

      await stateManager.syncWorkerData([brokerStat1]);

      assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)!.workers.size, 2);

      assert.deepStrictEqual(_.omit(capacityManager.workerStatsSnapshot.getBroker('func1', false)!.getWorker('worker1')!.toJSON(), 'pid', 'registerTime'), {
        name: 'worker1',
        credential: 'id1',
        turfContainerStates: 'running',
        containerStatus: ContainerStatus.Created,
        data: { maxActivateRequests: 10, activeRequestCount: 1 }
      });
      assert.deepStrictEqual(_.omit(capacityManager.workerStatsSnapshot.getBroker('func1', false)!.getWorker('worker2')!.toJSON(), 'pid', 'registerTime'), {
        name: 'worker2',
        credential: 'id2',
        turfContainerStates: 'running',
        containerStatus: ContainerStatus.Created,
        data: { maxActivateRequests: 10, activeRequestCount: 6 }
      });

      await turf.stop('worker2');
      await stateManager.syncWorkerData([brokerStat1]);

      assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)!.workers.size, 1);
      assert.deepStrictEqual(capacityManager.workerStatsSnapshot.getBroker('func1', false)!.getWorker('worker2'), null);

      // should delete directory after 5 minutes.
      let rmdirCalled = false;
      mm(fs.promises, 'rmdir', async (name: any, options: any) => {
        assert.strictEqual(name, path.dirname(starters.logPath(capacityManager.workerStatsSnapshot.config.logger.dir, 'worker2', 'dummy')));
        assert.deepStrictEqual(options, { recursive: true });
        rmdirCalled = true;
      });

      clock.tick(10 * 1000 * 60);
      assert(rmdirCalled);
    });

    it('should not sync with empty psData', async () => {
      await agent.setFunctionProfile([{
        name: 'func1',
        url: `file://${__dirname}`,
        runtime: 'aworker',
        signature: 'xxx',
        sourceFile: 'index.js',
      }], 'WAIT');

      const brokerStat1 = {
        functionName: 'func1',
        inspector: false,
        workers: [{
          name: 'worerk1',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }],
      };

      controlPlane.capacityManager.workerStatsSnapshot.register('func1', 'worker1', 'id1', false);

      const beforeSync = controlPlane.capacityManager.workerStatsSnapshot.getBroker('func1', false)!.getWorker('worker1')!.toJSON();

      await stateManager.syncWorkerData([brokerStat1]);

      const afterSync = controlPlane.capacityManager.workerStatsSnapshot.getBroker('func1', false)!.getWorker('worker1')!.toJSON();

      assert.deepStrictEqual(beforeSync, afterSync);
    });
  });
});
