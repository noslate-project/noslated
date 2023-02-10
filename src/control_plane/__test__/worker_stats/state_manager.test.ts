import path from 'path';
import * as fs from 'fs';
import assert from 'assert';

import mm from 'mm';
import _ from 'lodash';

import { NoslatedClient } from '#self/sdk';
import * as common from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import * as starters from '#self/control_plane/starter/index';
import { FIXTURES_DIR } from '#self/test/util';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import { DefaultEnvironment } from '#self/test/env/environment';
import { workerLogPath } from '#self/control_plane/container/container_manager';

const simpleSandbox = path.resolve(FIXTURES_DIR, 'sandbox_simple');

// TODO:
describe.skip(common.testName(__filename), () => {
  let stateManager: StateManager;
  let capacityManager: CapacityManager;

  const env = new DefaultEnvironment({
    createTestClock: true,
  });
  let agent: NoslatedClient;
  let controlPlane: ControlPlane;

  beforeEach(async () => {
    agent = env.agent;
    controlPlane = env.control;

    ({ stateManager, capacityManager } = controlPlane);
  });

  describe('updateContainerStatusByReport()', () => {
    it('should update regularly', async () => {
      await agent.setFunctionProfile(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
          {
            name: 'func2',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'cred1',
        false
      );
      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func2',
        'worker1',
        'cred1',
        false
      );

      const worker1 = capacityManager.workerStatsSnapshot.getWorker(
        'func1',
        false,
        'worker1'
      );
      const worker2 = capacityManager.workerStatsSnapshot.getWorker(
        'func2',
        false,
        'worker1'
      );

      assert(worker1);
      assert(worker2);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Ready);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.RequestDrained,
        requestId: '',
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerDisconnected,
        requestId: '',
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: 'Unknown state',
        requestId: '',
      });

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func2',
        name: 'worker1',
        isInspector: false,
        event: 'Unknown state',
        requestId: '',
      });

      stateManager.updateContainerStatusByReport({
        functionName: 'func2',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerDisconnected,
        requestId: '',
      });

      assert.strictEqual(worker2.containerStatus, ContainerStatus.Unknown);
    });

    it('should not update with illegal ContainerStatusReport order', async () => {
      await agent.setFunctionProfile(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'cred1',
        false
      );

      const worker = capacityManager.workerStatsSnapshot.getWorker(
        'func1',
        false,
        'worker1'
      );

      assert(worker);

      assert.rejects(
        async () => {
          await worker.ready();
        },
        {
          message: /stopped unexpected after start./,
        }
      );

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.RequestDrained,
        requestId: '',
      });

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      stateManager.updateContainerStatusByReport({
        functionName: 'func1',
        name: 'worker1',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });
  });

  describe('syncWorkerData()', () => {
    it('should sync', async () => {
      await agent.setFunctionProfile(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const brokerStat1 = {
        functionName: 'func1',
        inspector: false,
        workers: [
          {
            name: 'worker1',
            maxActivateRequests: 10,
            activeRequestCount: 1,
          },
          {
            name: 'worker2',
            maxActivateRequests: 10,
            activeRequestCount: 6,
          },
        ],
      };

      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'id1',
        false
      );
      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func1',
        'worker2',
        'id2',
        false
      );

      // TODO:
      // await controlPlane.turf.create('worker1', simpleSandbox);
      // await controlPlane.turf.create('worker2', simpleSandbox);
      // await controlPlane.turf.start('worker1');
      // await controlPlane.turf.start('worker2');

      await stateManager.syncWorkerData([brokerStat1]);

      assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        capacityManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        2
      );

      assert.deepStrictEqual(
        _.omit(
          capacityManager.workerStatsSnapshot
            .getBroker('func1', false)!
            .getWorker('worker1')!
            .toJSON(),
          'pid',
          'registerTime'
        ),
        {
          name: 'worker1',
          credential: 'id1',
          turfContainerStates: 'running',
          containerStatus: ContainerStatus.Created,
          data: { maxActivateRequests: 10, activeRequestCount: 1 },
        }
      );
      {
        const worker2 = capacityManager.workerStatsSnapshot
          .getBroker('func1', false)!
          .getWorker('worker2');
        assert(worker2);
        assert.deepStrictEqual(
          _.omit(worker2.toJSON(), 'pid', 'registerTime'),
          {
            name: 'worker2',
            credential: 'id2',
            turfContainerStates: 'running',
            containerStatus: ContainerStatus.Created,
            data: { maxActivateRequests: 10, activeRequestCount: 6 },
          }
        );

        process.kill(worker2.pid!, 'SIGKILL');
        await stateManager.syncWorkerData([brokerStat1]);
      }

      assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        capacityManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        1
      );
      assert.deepStrictEqual(
        capacityManager.workerStatsSnapshot
          .getBroker('func1', false)!
          .getWorker('worker2'),
        null
      );

      // should delete directory after 5 minutes.
      let rmCalled = false;
      mm(fs.promises, 'rm', async (name: any, options: any) => {
        assert.strictEqual(
          name,
          path.dirname(
            workerLogPath(
              capacityManager.workerStatsSnapshot.config.logger.dir,
              'worker2',
              'dummy'
            )
          )
        );
        assert.deepStrictEqual(options, { recursive: true });
        rmCalled = true;
      });

      env.testClock.tick(10 * 1000 * 60);
      assert(rmCalled);
    });

    it('should not sync with empty psData', async () => {
      await agent.setFunctionProfile(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const brokerStat1 = {
        functionName: 'func1',
        inspector: false,
        workers: [
          {
            name: 'worerk1',
            maxActivateRequests: 10,
            activeRequestCount: 1,
          },
        ],
      };

      controlPlane.capacityManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'id1',
        false
      );

      const beforeSync = controlPlane.capacityManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      await stateManager.syncWorkerData([brokerStat1]);

      const afterSync = controlPlane.capacityManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      assert.deepStrictEqual(beforeSync, afterSync);
    });
  });
});
