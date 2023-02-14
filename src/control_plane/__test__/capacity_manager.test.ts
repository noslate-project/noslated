import assert from 'assert';
import EventEmitter from 'events';
import fs from 'fs';
import path from 'path';

import _ from 'lodash';
import mm from 'mm';
import sinon from 'sinon';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { ControlPlane } from '#self/control_plane/index';
import { createDeferred } from '#self/lib/util';
import { DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager';
import { mockClientCreatorForManager } from '#self/test/util';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { TurfContainerStates } from '#self/lib/turf/types';
import {
  ContainerStatus,
  ContainerStatusReport,
  ControlPanelEvent,
} from '#self/lib/constants';
import { startTurfD, stopTurfD } from '#self/test/turf';
import {
  registerContainers,
  TestContainerManager,
} from './test_container_manager';
import { workerLogPath } from '../container/container_manager';
import { Broker, Worker, WorkerInitData } from '../worker_stats';

describe(common.testName(__filename), function () {
  this.timeout(10_000);

  const brokerData1 = {
    functionName: 'func',
    inspector: false,
    workers: [
      {
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 1,
      },
      {
        name: 'foo',
        maxActivateRequests: 10,
        activeRequestCount: 6,
      },
    ],
  };

  const brokerData2 = {
    functionName: 'lambda',
    inspector: false,
    workers: [
      {
        name: 'coco',
        maxActivateRequests: 10,
        activeRequestCount: 1,
      },
      {
        name: 'cocos',
        maxActivateRequests: 10,
        activeRequestCount: 3,
      },
      {
        name: 'alibaba',
        maxActivateRequests: 10,
        activeRequestCount: 4,
      },
    ],
  };

  let clock: common.TestClock;
  let control: ControlPlane;
  let testContainerManager: TestContainerManager;

  let capacityManager: CapacityManager;

  beforeEach(async () => {
    mockClientCreatorForManager(DataPlaneClientManager);
    startTurfD();
    clock = common.createTestClock({
      shouldAdvanceTime: true,
    });
    testContainerManager = new TestContainerManager(clock);
    control = new ControlPlane(config, {
      clock,
      containerManager: testContainerManager,
    });
    await control.ready();
    ({ capacityManager } = control);
  });

  afterEach(async () => {
    mm.restore();
    await control.close();
    clock.uninstall();
    stopTurfD();
  });

  describe('#syncWorkerData()', () => {
    it('should sync', async () => {
      const { functionProfileManager } = capacityManager;
      functionProfileManager.set(
        [
          {
            name: 'func',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
          {
            name: 'lambda',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const { promise, resolve } = createDeferred<void>();
      functionProfileManager.once('changed', () => {
        resolve();
      });
      await promise;

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'hello',
        credential: 'world',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'foo',
        credential: 'bar',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      registerContainers(
        testContainerManager,
        capacityManager.workerStatsSnapshot,
        [
          { name: 'foo', status: TurfContainerStates.stopped, pid: 123 },
          { name: 'fop', status: TurfContainerStates.stopped, pid: 124 },
          { name: 'foq', status: TurfContainerStates.stopping, pid: 125 },
          { name: 'for', status: TurfContainerStates.forkwait, pid: 126 },
          { name: 'fos', status: TurfContainerStates.running, pid: 127 },
          { name: 'fot', status: TurfContainerStates.init, pid: 128 },
          { name: 'fou', status: TurfContainerStates.running, pid: 129 },
        ]
      );

      const syncSpy = sinon.spy(capacityManager.workerStatsSnapshot, 'sync');
      const correctSpy = sinon.spy(
        capacityManager.workerStatsSnapshot,
        'correct'
      );

      let workerStoppedBroker!: Broker;
      let workerStoppedWorker!: Worker;
      capacityManager.workerStatsSnapshot.on(
        'workerStopped',
        (emitExceptionMessage, state, broker, worker) => {
          assert.strictEqual(emitExceptionMessage, undefined);
          workerStoppedWorker = worker;
          workerStoppedBroker = broker;
        }
      );

      await control.stateManager.syncWorkerData([brokerData1]);

      assert(syncSpy.called);
      assert(correctSpy.called);
      assert.ok(testContainerManager.getContainer('foo') == null);

      assert.strictEqual(capacityManager.workerStatsSnapshot.brokers.size, 1);
      const broker = capacityManager.workerStatsSnapshot.getBroker(
        'func',
        false
      );

      // foo should be corrected because it's stopped in psData.
      assert.strictEqual(broker?.startingPool.size, 1);
      assert.strictEqual(broker?.workers.size, 1);
      const worker = broker?.getWorker('hello')?.toJSON();
      assert.deepStrictEqual(_.omit(worker, ['registerTime']), {
        name: 'hello',
        credential: 'world',
        pid: null,
        containerStatus: ContainerStatus.Created,
        turfContainerStates: null,
        data: {
          activeRequestCount: 1,
          maxActivateRequests: 10,
        },
      });
      assert.strictEqual(typeof worker?.registerTime, 'number');
      assert.strictEqual(workerStoppedBroker, broker);
      assert.deepStrictEqual(
        _.omit(workerStoppedWorker.toJSON(), ['registerTime']),
        {
          name: 'foo',
          credential: 'bar',
          pid: 123,
          data: {
            maxActivateRequests: 10,
            activeRequestCount: 6,
          },
          containerStatus: ContainerStatus.Stopped,
          turfContainerStates: TurfContainerStates.stopped,
        }
      );

      // should delete directory after 5 minutes.
      let rmCalled = false;
      mm(fs.promises, 'rm', async (name: any, options: any) => {
        assert.strictEqual(
          name,
          path.dirname(
            workerLogPath(
              capacityManager.workerStatsSnapshot.config.logger.dir,
              'foo',
              'dummy'
            )
          )
        );
        assert.deepStrictEqual(options, { recursive: true });
        rmCalled = true;
      });

      clock.tick(10 * 1000 * 60);
      assert(rmCalled);
    });
  });

  describe('get #virtualMemoryUsed()', () => {
    it('should get virtual memory used', async () => {
      const { functionProfileManager } = capacityManager;
      functionProfileManager.set(
        [
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
        ],
        'WAIT'
      );

      const { promise, resolve } = createDeferred<void>();
      functionProfileManager.once('changed', () => {
        resolve();
      });
      await promise;

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'hello',
        credential: 'world',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'foo',
        credential: 'barworld',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'coco',
        credential: 'nut',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      // 未 ready 不计入 virtual memory size
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'cocos',
        credential: '2d',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'alibaba',
        credential: 'seed of hope',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      registerContainers(
        testContainerManager,
        capacityManager.workerStatsSnapshot,
        [
          { pid: 1, name: 'hello', status: TurfContainerStates.running },
          { pid: 2, name: 'foo', status: TurfContainerStates.running },
          { pid: 3, name: 'coco', status: TurfContainerStates.running },
          { pid: 4, name: 'cocos', status: TurfContainerStates.running },
          { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
        ]
      );

      await control.stateManager.syncWorkerData([brokerData1, brokerData2]);

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'hello',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'foo',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'lambda',
        name: 'coco',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'lambda',
        name: 'alibaba',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      assert.strictEqual(
        capacityManager.virtualMemoryUsed,
        512000000 * 2 + 128000000 * 2
      );
    });
  });

  describe('#tryBatchLaunch()', () => {
    it('should try batch launch', async () => {
      let called = 0;
      mm(
        capacityManager.plane.workerLauncher,
        'tryLaunch',
        async (event: ControlPanelEvent, { funcName, options }: any) => {
          assert.strictEqual(event, ControlPanelEvent.Expand);
          assert.strictEqual(funcName, 'func');
          assert.deepStrictEqual(options, { inspect: true });
          called++;
        }
      );
      let workerInitData = new WorkerInitData('func', { inspect: true });
      await control.controller.tryBatchLaunch(workerInitData, 10);
      assert.strictEqual(called, 10);

      called = 0;
      mm(
        capacityManager.plane.workerLauncher,
        'tryLaunch',
        async (event: ControlPanelEvent, { funcName, options }: any) => {
          assert.strictEqual(event, ControlPanelEvent.Expand);
          assert.strictEqual(funcName, 'func');
          assert.deepStrictEqual(options, { inspect: false });
          called++;
        }
      );
      workerInitData = new WorkerInitData('func', { inspect: false });
      await control.controller.tryBatchLaunch(workerInitData, 3);
      assert.strictEqual(called, 3);

      called = 0;
      mm(capacityManager.plane.workerLauncher, 'tryLaunch', async () => {
        called++;
        if (called === 2) throw new Error('💩');
      });

      assert.rejects(async () => {
        const workerInitData = new WorkerInitData('func', { inspect: false });
        await control.controller.tryBatchLaunch(workerInitData, 3);
      }, /💩/);
    });
  });

  describe('#stopWorker()', () => {
    it('should destroy worker', async () => {
      registerContainers(
        testContainerManager,
        control.capacityManager.workerStatsSnapshot,
        [{ name: 'foo', pid: 1, status: TurfContainerStates.running }]
      );
      await control.controller.stopWorker('foo');
      await testContainerManager.reconcileContainers();
      assert.strictEqual(
        testContainerManager.getContainer('foo')?.status,
        TurfContainerStates.stopping
      );
    });

    it('should destroy worker failed', async () => {
      testContainerManager.setTestContainers([
        { name: 'foo', pid: 1, status: TurfContainerStates.running },
      ]);
      const stub = sinon.stub(
        testContainerManager.getContainer('foo')!,
        'stop'
      );
      stub.rejects(/failed to stop/);

      await assert.rejects(
        () => control.controller.stopWorker('foo'),
        /failed to stop/
      );
    });
  });

  describe('#stopAllWorkers()', () => {
    it('should stop all workers', async () => {
      const { functionProfileManager } = capacityManager;
      functionProfileManager.set(
        [
          {
            name: 'func',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
          {
            name: 'lambda',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const { promise, resolve } = createDeferred<void>();
      functionProfileManager.once('changed', () => {
        resolve();
      });
      await promise;

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'hello',
        credential: 'world',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'foo',
        credential: 'bar',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'coco',
        credential: 'nut',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'cocos',
        credential: '2d',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'alibaba',
        credential: 'seed of hope',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      await control.stateManager.syncWorkerData([brokerData1, brokerData2]);

      let stopNames: string[] = [];
      mm(control.controller, 'stopWorker', async (name: string) => {
        stopNames.push(name);
      });

      await control.controller.stopAllWorkers(['func']);
      assert.deepStrictEqual(stopNames.sort(), ['foo', 'hello']);

      stopNames = [];
      await control.controller.stopAllWorkers(['lambda']);
      assert.deepStrictEqual(stopNames.sort(), ['alibaba', 'coco', 'cocos']);

      stopNames = [];
      await control.controller.stopAllWorkers(['func', 'lambda']);
      assert.deepStrictEqual(stopNames.sort(), [
        'alibaba',
        'coco',
        'cocos',
        'foo',
        'hello',
      ]);
    });
  });

  describe('#autoScale()', () => {
    for (let id = 0; id < 2; id++) {
      it(`should auto scale with ${
        id === 0 ? 'enough' : 'not enough'
      } memory`, async () => {
        const { functionProfileManager } = capacityManager;
        functionProfileManager.set(
          [
            {
              name: 'func',
              url: `file://${__dirname}`,
              runtime: 'aworker',
              signature: 'xxx',
              sourceFile: 'index.js',
            },
            {
              name: 'lambda',
              url: `file://${__dirname}`,
              runtime: 'aworker',
              signature: 'xxx',
              sourceFile: 'index.js',
            },
          ],
          'WAIT'
        );

        const { promise, resolve } = createDeferred<void>();
        functionProfileManager.once('changed', () => {
          resolve();
        });
        await promise;

        testContainerManager.setTestContainers([
          { pid: 1, name: 'hello', status: TurfContainerStates.running },
          { pid: 2, name: 'foo', status: TurfContainerStates.running },
          { pid: 3, name: 'coco', status: TurfContainerStates.running },
          { pid: 4, name: 'cocos', status: TurfContainerStates.running },
          { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
        ]);

        capacityManager.workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        capacityManager.workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        capacityManager.workerStatsSnapshot.register({
          funcName: 'lambda',
          processName: 'coco',
          credential: 'nut',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });
        capacityManager.workerStatsSnapshot.register({
          funcName: 'lambda',
          processName: 'cocos',
          credential: '2d',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        capacityManager.workerStatsSnapshot.register({
          funcName: 'lambda',
          processName: 'alibaba',
          credential: 'seed of hope',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });
        if (id === 0)
          mm(capacityManager, 'virtualMemoryPoolSize', 512 * 1024 * 1024 * 6);

        capacityManager.updateWorkerContainerStatus({
          functionName: 'func',
          name: 'hello',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        });

        capacityManager.updateWorkerContainerStatus({
          functionName: 'func',
          name: 'foo',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        });

        capacityManager.updateWorkerContainerStatus({
          functionName: 'lambda',
          name: 'coco',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        });

        capacityManager.updateWorkerContainerStatus({
          functionName: 'lambda',
          name: 'cocos',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        });

        capacityManager.updateWorkerContainerStatus({
          functionName: 'lambda',
          name: 'alibaba',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,

          requestId: '',
        });

        await control.stateManager.syncWorkerData([brokerData1, brokerData2]);

        capacityManager.workerStatsSnapshot!.getWorker(
          'func',
          false,
          'hello'
        )!.data!.activeRequestCount = 10;
        capacityManager.workerStatsSnapshot!.getWorker(
          'func',
          false,
          'foo'
        )!.data!.activeRequestCount = 10;
        capacityManager.workerStatsSnapshot!.getWorker(
          'lambda',
          false,
          'coco'
        )!.data!.activeRequestCount = 3;
        capacityManager.workerStatsSnapshot!.getWorker(
          'lambda',
          false,
          'cocos'
        )!.data!.activeRequestCount = 1;
        capacityManager.workerStatsSnapshot!.getWorker(
          'lambda',
          false,
          'alibaba'
        )!.data!.activeRequestCount = 2;
        capacityManager.workerStatsSnapshot!.getBroker(
          'lambda',
          false
        )!.redundantTimes = 60;

        let tryLaunchCalled = 0;
        let reduceCapacityCalled = 0;
        let stopWorkerCalled = 0;
        mm(
          capacityManager.plane.workerLauncher,
          'tryLaunch',
          async (event: ControlPanelEvent, { funcName, options }: any) => {
            assert.strictEqual(event, ControlPanelEvent.Expand);
            assert.strictEqual(funcName, 'func');
            assert.deepStrictEqual(options, { inspect: false });
            tryLaunchCalled++;
          }
        );
        mm(
          capacityManager.plane.dataPlaneClientManager,
          'reduceCapacity',
          async (data: { brokers: string | any[] }) => {
            assert.strictEqual(data.brokers.length, 1);
            assert.strictEqual(data.brokers[0].functionName, 'lambda');
            assert.strictEqual(data.brokers[0].inspector, false);
            assert.deepStrictEqual(data.brokers[0].workers, [
              { name: 'cocos', credential: '2d' },
              { name: 'alibaba', credential: 'seed of hope' },
            ]);
            reduceCapacityCalled++;

            const ret = JSON.parse(JSON.stringify(data));
            ret.brokers[0].workers.pop();
            return ret.brokers;
          }
        );
        mm(control.controller, 'stopWorker', async (name: any) => {
          assert.strictEqual(name, 'cocos');
          stopWorkerCalled++;
        });

        await capacityManager.autoScale();

        assert.strictEqual(tryLaunchCalled, id === 0 ? 1 : 0);
        assert.strictEqual(reduceCapacityCalled, 1);
        assert.strictEqual(stopWorkerCalled, 1);
      });
    }

    it('should auto shrink when function not exist in function profile manager', async () => {
      const { functionProfileManager } = capacityManager;
      functionProfileManager.set(
        [
          {
            name: 'func',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
          {
            name: 'lambda',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const { promise, resolve } = createDeferred<void>();
      functionProfileManager.once('changed', () => {
        resolve();
      });
      await promise;

      testContainerManager.setTestContainers([
        { pid: 1, name: 'hello', status: TurfContainerStates.running },
        { pid: 2, name: 'foo', status: TurfContainerStates.running },
        { pid: 3, name: 'coco', status: TurfContainerStates.running },
        { pid: 4, name: 'cocos', status: TurfContainerStates.running },
        { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
      ]);

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'hello',
        credential: 'world',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'foo',
        credential: 'bar',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'coco',
        credential: 'nut',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'cocos',
        credential: '2d',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });
      capacityManager.workerStatsSnapshot.register({
        funcName: 'lambda',
        processName: 'alibaba',
        credential: 'seed of hope',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      functionProfileManager.set([], 'WAIT');

      const { promise: promise2, resolve: resolve2 } = createDeferred<void>();
      functionProfileManager.once('changed', () => {
        resolve2();
      });
      await promise2;

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'hello',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'func',
        name: 'foo',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'lambda',
        name: 'coco',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'lambda',
        name: 'cocos',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      capacityManager.updateWorkerContainerStatus({
        functionName: 'lambda',
        name: 'alibaba',
        isInspector: false,
        event: ContainerStatusReport.ContainerInstalled,
        requestId: '',
      });

      await control.stateManager.syncWorkerData([brokerData1, brokerData2]);
      capacityManager.workerStatsSnapshot!.getWorker(
        'func',
        false,
        'hello'
      )!.data!.activeRequestCount = 10;
      capacityManager.workerStatsSnapshot!.getWorker(
        'func',
        false,
        'foo'
      )!.data!.activeRequestCount = 10;
      capacityManager.workerStatsSnapshot!.getBroker(
        'func',
        false
      )!.redundantTimes = 60;
      capacityManager.workerStatsSnapshot!.getWorker(
        'lambda',
        false,
        'coco'
      )!.data!.activeRequestCount = 3;
      capacityManager.workerStatsSnapshot!.getWorker(
        'lambda',
        false,
        'cocos'
      )!.data!.activeRequestCount = 1;
      capacityManager.workerStatsSnapshot!.getWorker(
        'lambda',
        false,
        'alibaba'
      )!.data!.activeRequestCount = 2;
      capacityManager.workerStatsSnapshot!.getBroker(
        'lambda',
        false
      )!.redundantTimes = 60;

      let tryLaunchCalled = 0;
      let reduceCapacityCalled = 0;
      let stopWorkerCalled = 0;
      mm(capacityManager.plane.workerLauncher, 'tryLaunch', async () => {
        tryLaunchCalled++;
      });
      mm(
        capacityManager.plane.dataPlaneClientManager,
        'reduceCapacity',
        async (data: { brokers: string | any[] }) => {
          assert.strictEqual(data.brokers.length, 2);

          assert.strictEqual(data.brokers[0].functionName, 'func');
          assert.strictEqual(data.brokers[0].inspector, false);
          assert.deepStrictEqual(data.brokers[0].workers, [
            { name: 'foo', credential: 'bar' },
            { name: 'hello', credential: 'world' },
          ]);

          assert.strictEqual(data.brokers[1].functionName, 'lambda');
          assert.strictEqual(data.brokers[1].inspector, false);
          assert.deepStrictEqual(data.brokers[1].workers, [
            { name: 'cocos', credential: '2d' },
            { name: 'alibaba', credential: 'seed of hope' },
            { name: 'coco', credential: 'nut' },
          ]);

          reduceCapacityCalled++;

          return data.brokers;
        }
      );
      let left = ['cocos', 'coco', 'alibaba', 'foo', 'hello'];
      mm(control.controller, 'stopWorker', async (name: string) => {
        assert(left.includes(name));
        left = left.filter(n => name !== n);
        stopWorkerCalled++;
      });

      await capacityManager.autoScale();

      assert.strictEqual(tryLaunchCalled, 0);
      assert.strictEqual(reduceCapacityCalled, 1);
      assert.strictEqual(stopWorkerCalled, 5);
    });

    it('a wrong situation of worker count infinitely increasing', async () => {
      // unexpecated Error: No enough virtual memory (used: 1073741824 + need: 536870912) > total: 1073741824
      //                 at WorkerLauncher.tryLaunch (/usr/local/noslate/control_plane/worker_launcher.js:117:19)
      //                 ...
      //                 at async CapacityManager.#expand (/usr/local/noslate/control_plane/capacity_manager.js:111:5)
      //                 at async CapacityManager.autoScale (/usr/local/noslate/control_plane/capacity_manager.js:200:7)

      // test path:
      //   1. 1gb memory pool
      //   2. 2 workers with per 512mb and maximum activate request count
      //   3. do autoScale()

      testContainerManager.setTestContainers([
        { pid: 1, name: 'hello', status: TurfContainerStates.running },
        { pid: 2, name: 'foo', status: TurfContainerStates.running },
      ]);

      mm(control.controller, 'tryBatchLaunch', async () => {
        throw new Error('Should not be called.');
      });

      const { functionProfileManager } = capacityManager;
      functionProfileManager.set(
        [
          {
            name: 'func',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );
      await EventEmitter.once(functionProfileManager, 'changed');

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'hello',
        credential: 'world',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      capacityManager.workerStatsSnapshot.register({
        funcName: 'func',
        processName: 'foo',
        credential: 'bar',
        options: { inspect: false },
        disposable: false,
        toReserve: false,
      });

      mm(brokerData1.workers[0], 'activeRequestCount', 10);
      mm(brokerData1.workers[1], 'activeRequestCount', 10);
      mm(brokerData1.workers[0], 'resourceLimit', {
        memory: 512 * 1024 * 1024,
      });
      mm(brokerData1.workers[1], 'resourceLimit', {
        memory: 512 * 1024 * 1024,
      });
      mm(capacityManager, 'virtualMemoryPoolSize', 1024 * 1024 * 1024);

      await control.stateManager.syncWorkerData([brokerData1]);
      await assert.doesNotReject(capacityManager.autoScale());
    });
  });
});
