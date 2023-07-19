import assert from 'assert';
import mm from 'mm';
import * as common from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { TurfContainerStates } from '#self/lib/turf/types';
import { WorkerStatusReport } from '#self/lib/constants';
import {
  registerContainers,
  TestContainerManager,
} from './test_container_manager';
import { StateManager } from '../worker_stats/state_manager';
import { WorkerStatusReportEvent } from '../events';
import { registerWorkers } from './util';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { DataPlaneClientManager } from '../data_plane_client/manager';
import { mockClientCreatorForManager } from '#self/test/util';
import { Broker } from '../worker_stats/broker';
import { funcData } from './worker_stats/test_data';
import { noslated } from '#self/proto/root';

describe(common.testName(__filename), function () {
  this.timeout(10_000);

  const brokerData1: noslated.data.IBrokerStats = {
    functionName: 'func',
    inspector: false,
    workers: [
      {
        name: 'hello',
        activeRequestCount: 1,
      },
      {
        name: 'foo',
        activeRequestCount: 6,
      },
    ],
  };

  const brokerData2: noslated.data.IBrokerStats = {
    functionName: 'lambda',
    inspector: false,
    workers: [
      {
        name: 'coco',
        activeRequestCount: 1,
      },
      {
        name: 'cocos',
        activeRequestCount: 3,
      },
      {
        name: 'alibaba',
        activeRequestCount: 4,
      },
    ],
  };

  let clock: common.TestClock;
  let control: ControlPlane;
  let testContainerManager: TestContainerManager;

  let capacityManager: CapacityManager;
  let stateManager: StateManager;
  let profileManager: FunctionProfileManager;

  beforeEach(async () => {
    mockClientCreatorForManager(DataPlaneClientManager);
    clock = common.createTestClock({
      shouldAdvanceTime: true,
    });
    testContainerManager = new TestContainerManager(clock);
    control = new ControlPlane({
      clock,
      containerManager: testContainerManager,
    });
    await control.ready();
    capacityManager = control._ctx.getInstance('capacityManager');
    profileManager = control._ctx.getInstance('functionProfile');
    stateManager = control._ctx.getInstance('stateManager');
  });

  afterEach(async () => {
    mm.restore();
    await control.close();
    clock.uninstall();
  });

  describe('get #virtualMemoryUsed()', () => {
    it('should get virtual memory used', async () => {
      await profileManager.setProfiles([
        {
          name: 'func',
          url: `file://${__dirname}`,
          runtime: 'aworker',
          signature: 'xxx',
          sourceFile: 'index.js',
          resourceLimit: {
            memory: 512000000,
          },
        },
        {
          name: 'lambda',
          url: `file://${__dirname}`,
          runtime: 'aworker',
          signature: 'xxx',
          sourceFile: 'index.js',
          resourceLimit: {
            memory: 128000000,
          },
        },
      ]);

      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: false },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foo',
          credential: 'barworld',
          options: { inspect: false },
          toReserve: false,
        },
        {
          funcName: 'lambda',
          processName: 'coco',
          credential: 'nut',
          options: { inspect: false },
          toReserve: false,
        },
        {
          // 未 ready 不计入 virtual memory size
          funcName: 'lambda',
          processName: 'cocos',
          credential: '2d',
          options: { inspect: false },
          toReserve: false,
        },
        {
          funcName: 'lambda',
          processName: 'alibaba',
          credential: 'seed of hope',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      registerContainers(testContainerManager, stateManager, [
        { pid: 1, name: 'hello', status: TurfContainerStates.running },
        { pid: 2, name: 'foo', status: TurfContainerStates.running },
        { pid: 3, name: 'coco', status: TurfContainerStates.running },
        { pid: 4, name: 'cocos', status: TurfContainerStates.running },
        { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
      ]);

      await stateManager._syncBrokerData([brokerData1, brokerData2]);

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func',
          name: 'hello',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
        })
      );

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func',
          name: 'foo',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
        })
      );

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'lambda',
          name: 'coco',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
        })
      );

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'lambda',
          name: 'alibaba',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
        })
      );

      assert.strictEqual(
        capacityManager.virtualMemoryUsed,
        512000000 * 2 + 128000000 * 2
      );
    });
  });

  describe('.evaluateWaterLevel()', () => {
    beforeEach(async () => {
      await profileManager.setProfiles(funcData);
    });

    it('should evaluate when some worker stopped (low)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 10,
          },
          {
            name: 'foo',
            activeRequestCount: 0,
          },
        ]
      }]);
      // 更新运行状态
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerDisconnected);

      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), -1);
    });

    it('should evaluate when some worker stopped (high)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 10,
          },
          {
            name: 'foo',
            activeRequestCount: 0,
          },
        ]
      }]);
      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerDisconnected);

      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 1);
    });

    it('should evaluate with initiating workers, ignore initiating workers', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      // 只启动一个
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 5,
          },
        ]
      }]);
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 0);
    });

    it('should evaluate with initiating workers (high)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar1',
        },
      ]);

      // 只启动一个
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 10,
          },
        ]
      }]);

      assert.strictEqual(
        capacityManager.allowExpandingOnRequestQueueing({
          isInspect: false,
          name: 'func',
          queuedRequestCount: 1,
          requestId: '123',
          timestamp: Date.now(),
        }),
        false
      );
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 1);
    });

    it('should evaluate water level', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 0);
    });

    it('should evaluate water level with one worker left', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;

      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);

      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 4,
          },
        ]
      }]);

      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 0);
    });

    it('should evaluate water level (still redundant, high)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 8,
          },
          {
            name: 'foo',
            activeRequestCount: 8,
          },
        ]
      }]);
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 1);
    });

    it('should evaluate water level (still redundant, low)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            activeRequestCount: 0,
          },
        ]
      }]);
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 0);
    });

    it('should evaluate water level (low 1)', async () => {
      await profileManager.setProfiles([
        { ...funcData[0], worker: { reservationCount: 1 } },
      ]);
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]
      }]);
      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), -1);
    });

    it('should evaluate water level (low 2)', async () => {
      await profileManager.setProfiles([
        { ...funcData[0], worker: { reservationCount: 1 } },
      ]);
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 3,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 3,
          },
        ]
      }]);
      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), -1);
    });

    it('should evaluate water level (low 1, no reservation)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]
      }]);
      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), -2);
    });

    it('should evaluate water level (low 2, no reservation)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 3,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 3,
          },
        ]
      }]);
      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), -1);
    });

    it('should evaluate water level (low, expansionOnly)', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]
      }]);
      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker, true), 0);
    });

    it('should reset redundantTimes', () => {
      const broker = stateManager.getOrCreateBroker('func', false)!;
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('foo')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('hello')!
        .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: [
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 7,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 7,
          },
        ]
      }]);

      broker.redundantTimes = 60;
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 0);
      assert.strictEqual(broker.redundantTimes, 0);
    });

    it('should evaluate (high with several workers)', async () => {
      await profileManager.setProfiles([
        { ...funcData[0], worker: { replicaCountLimit: 50 } },
      ]);
      const broker = stateManager.getOrCreateBroker('func', false)!;
      const mocked: noslated.data.IWorkerStats[] = [];
      for (let i = 0; i < 20; i++) {
        mocked.push({
          name: String(i),
          // maxActivateRequests: 10,
          activeRequestCount: 10,
        });
        registerWorkers(broker, [
          {
            processName: String(i),
            credential: String(i),
            funcName: 'func',
          },
        ]);

        broker
          .getWorker(String(i))!
          .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      }
      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: mocked
      }]);
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 9);
    });

    it('should evaluate (high with several workers, up to replicaCountLimit)', async () => {
      await profileManager.setProfiles([
        { ...funcData[0], worker: { replicaCountLimit: 25 } },
      ]);
      const broker = stateManager.getOrCreateBroker('func', false)!;
      const mocked: noslated.data.IWorkerStats[] = [];
      for (let i = 0; i < 20; i++) {
        mocked.push({
          name: String(i),
          // maxActivateRequests: 10,
          activeRequestCount: 10,
        });
        registerWorkers(broker, [
          {
            processName: String(i),
            credential: String(i),
            funcName: 'func',
          },
        ]);
        broker
          .getWorker(String(i))!
          .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      }
      stateManager._syncBrokerData([{
        functionName: 'func',
        workers: mocked
      }]);
      assert.strictEqual(capacityManager.evaluateWaterLevel(broker), 5);
    });
  });
});
