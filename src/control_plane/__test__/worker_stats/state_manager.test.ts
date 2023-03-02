import assert from 'assert';
import _ from 'lodash';
import * as common from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import {
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
} from '#self/control_plane/events';
import { registerContainers } from '../test_container_manager';
import { TurfContainerStates } from '#self/lib/turf';
import { TestEnvironment } from '../environment';
import { registerWorkers } from '../util';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { EventBus } from '#self/lib/event-bus';

describe(common.testName(__filename), () => {
  let eventBus: EventBus;
  let stateManager: StateManager;
  let functionProfile: FunctionProfileManager;

  const env = new TestEnvironment({
    createTestClock: true,
  });
  let controlPlane: ControlPlane;

  beforeEach(async () => {
    controlPlane = env.control;
    eventBus = controlPlane._ctx.getInstance('eventBus');
    stateManager = controlPlane._ctx.getInstance('stateManager');
    functionProfile = controlPlane._ctx.getInstance('functionProfile');
  });

  describe('updateContainerStatusByReport()', () => {
    it('should update regularly', async () => {
      await functionProfile.set(
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
      registerWorkers(stateManager.workerStatsSnapshot, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          funcName: 'func2',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);

      const worker1 = stateManager.workerStatsSnapshot.getWorker(
        'func1',
        false,
        'worker1'
      );
      const worker2 = stateManager.workerStatsSnapshot.getWorker(
        'func2',
        false,
        'worker1'
      );

      assert(worker1);
      assert(worker2);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Ready);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: 'Unknown state',
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func2',
          name: 'worker1',
          isInspector: false,
          event: 'Unknown state',
          requestId: '',
        })
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func2',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker2.containerStatus, ContainerStatus.Unknown);
    });

    it('should not update with illegal ContainerStatusReport order', async () => {
      await functionProfile.set(
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

      registerWorkers(stateManager.workerStatsSnapshot, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);

      const worker = stateManager.workerStatsSnapshot.getWorker(
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

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });
  });

  describe('syncWorkerData()', () => {
    it('should sync', async () => {
      await functionProfile.set(
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

      registerWorkers(stateManager.workerStatsSnapshot, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'id1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          funcName: 'func1',
          processName: 'worker2',
          credential: 'id2',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);

      registerContainers(
        env.containerManager,
        stateManager.workerStatsSnapshot,
        [
          { name: 'worker1', status: TurfContainerStates.running, pid: 123 },
          { name: 'worker2', status: TurfContainerStates.running, pid: 124 },
        ]
      );
      await stateManager.syncWorkerData([brokerStat1]);

      assert.strictEqual(stateManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        stateManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        2
      );

      assert.deepStrictEqual(
        _.omit(
          stateManager.workerStatsSnapshot
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

      const workerStoppedFuture = eventBus.once(WorkerStoppedEvent);
      {
        const worker2 = stateManager.workerStatsSnapshot
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

        await env.containerManager.getContainer('worker2')!.stop();
        await stateManager.syncWorkerData([brokerStat1]);
      }

      assert.strictEqual(stateManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        stateManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        1
      );
      assert.deepStrictEqual(
        stateManager.workerStatsSnapshot
          .getBroker('func1', false)!
          .getWorker('worker2'),
        null
      );

      const event = await workerStoppedFuture;
      assert.strictEqual(event.data.workerName, 'worker2');
    });

    it('should not sync with empty psData', async () => {
      await functionProfile.set(
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

      registerWorkers(stateManager.workerStatsSnapshot, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'id1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);

      const beforeSync = stateManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      await stateManager.syncWorkerData([brokerStat1]);

      const afterSync = stateManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      assert.deepStrictEqual(beforeSync, afterSync);
    });
  });
});
