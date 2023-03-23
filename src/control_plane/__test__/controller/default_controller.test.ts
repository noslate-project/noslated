import { ControlPlane } from '#self/control_plane';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { DefaultController } from '#self/control_plane/controllers';
import { DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager';
import { WorkerStatusReportEvent } from '#self/control_plane/events';
import { WorkerLauncher } from '#self/control_plane/worker_launcher';
import { Broker } from '#self/control_plane/worker_stats/broker';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import {
  WorkerStatusReport,
  ControlPlaneEvent,
  WorkerStatus,
} from '#self/lib/constants';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import { sleep } from '#self/lib/util';
import * as common from '#self/test/common';
import assert from 'assert';
import mm from 'mm';
import sinon from 'sinon';
import { TestEnvironment } from '../environment';
import { registerWorkers } from '../util';
import { funcData } from '../worker_stats/test_data';

describe(common.testName(__filename), () => {
  const env = new TestEnvironment({
    createTestClock: true,
  });
  let controlPlane: ControlPlane;
  let stateManager: StateManager;
  let functionProfile: FunctionProfileManager;
  let capacityManager: CapacityManager;
  let workerLauncher: WorkerLauncher;
  let dataPlaneClientManager: DataPlaneClientManager;
  let defaultController: DefaultController;

  beforeEach(async () => {
    controlPlane = env.control;
    stateManager = controlPlane._ctx.getInstance('stateManager');
    functionProfile = controlPlane._ctx.getInstance('functionProfile');
    capacityManager = controlPlane._ctx.getInstance('capacityManager');
    workerLauncher = controlPlane._ctx.getInstance('workerLauncher');
    dataPlaneClientManager = controlPlane._ctx.getInstance(
      'dataPlaneClientManager'
    );
    defaultController = controlPlane._ctx.getInstance('defaultController');
  });

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

  describe('#autoScale()', () => {
    for (let id = 0; id < 2; id++) {
      it(`should auto scale with ${
        id === 0 ? 'enough' : 'not enough'
      } memory`, async () => {
        await functionProfile.setProfiles([
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
        ]);

        env.containerManager.setTestContainers([
          { pid: 1, name: 'hello', status: TurfContainerStates.running },
          { pid: 2, name: 'foo', status: TurfContainerStates.running },
          { pid: 3, name: 'coco', status: TurfContainerStates.running },
          { pid: 4, name: 'cocos', status: TurfContainerStates.running },
          { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
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
            credential: 'bar',
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

        if (id === 0)
          mm(capacityManager, 'virtualMemoryPoolSize', 512 * 1024 * 1024 * 6);

        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'func',
            name: 'hello',
            isInspector: false,
            event: WorkerStatusReport.ContainerInstalled,
            requestId: '',
          })
        );

        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'func',
            name: 'foo',
            isInspector: false,
            event: WorkerStatusReport.ContainerInstalled,
            requestId: '',
          })
        );

        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'lambda',
            name: 'coco',
            isInspector: false,
            event: WorkerStatusReport.ContainerInstalled,
            requestId: '',
          })
        );

        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'lambda',
            name: 'cocos',
            isInspector: false,
            event: WorkerStatusReport.ContainerInstalled,
            requestId: '',
          })
        );

        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'lambda',
            name: 'alibaba',
            isInspector: false,
            event: WorkerStatusReport.ContainerInstalled,

            requestId: '',
          })
        );

        await stateManager._syncBrokerData([brokerData1, brokerData2]);

        stateManager.getWorker(
          'func',
          false,
          'hello'
        )!.data!.activeRequestCount = 10;
        stateManager.getWorker(
          'func',
          false,
          'foo'
        )!.data!.activeRequestCount = 10;
        stateManager.getWorker(
          'lambda',
          false,
          'coco'
        )!.data!.activeRequestCount = 3;
        stateManager.getWorker(
          'lambda',
          false,
          'cocos'
        )!.data!.activeRequestCount = 1;
        stateManager.getWorker(
          'lambda',
          false,
          'alibaba'
        )!.data!.activeRequestCount = 2;
        stateManager.getBroker('lambda', false)!.redundantTimes = 60;

        let tryLaunchCalled = 0;
        let reduceCapacityCalled = 0;
        mm(
          workerLauncher,
          'tryLaunch',
          async (event: ControlPlaneEvent, { funcName, options }: any) => {
            assert.strictEqual(event, ControlPlaneEvent.Expand);
            assert.strictEqual(funcName, 'func');
            assert.deepStrictEqual(options, { inspect: false });
            tryLaunchCalled++;
          }
        );
        mm(
          dataPlaneClientManager,
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

        await defaultController['autoScale']();

        assert.strictEqual(tryLaunchCalled, id === 0 ? 1 : 0);
        assert.strictEqual(reduceCapacityCalled, 1);
        assert.strictEqual(
          stateManager.getWorker('lambda', false, 'cocos')?.workerStatus,
          WorkerStatus.PendingStop
        );
      });
    }

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

      env.containerManager.setTestContainers([
        { pid: 1, name: 'hello', status: TurfContainerStates.running },
        { pid: 2, name: 'foo', status: TurfContainerStates.running },
      ]);

      mm(defaultController, 'tryBatchLaunch', async () => {
        throw new Error('Should not be called.');
      });

      await functionProfile.setProfiles([
        {
          name: 'func',
          url: `file://${__dirname}`,
          runtime: 'aworker',
          signature: 'xxx',
          sourceFile: 'index.js',
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
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      mm(brokerData1.workers[0], 'activeRequestCount', 10);
      mm(brokerData1.workers[1], 'activeRequestCount', 10);
      mm(brokerData1.workers[0], 'resourceLimit', {
        memory: 512 * 1024 * 1024,
      });
      mm(brokerData1.workers[1], 'resourceLimit', {
        memory: 512 * 1024 * 1024,
      });
      mm(capacityManager, 'virtualMemoryPoolSize', 1024 * 1024 * 1024);

      await stateManager._syncBrokerData([brokerData1]);
      await assert.doesNotReject(defaultController['autoScale']());
    });
  });

  describe('.mostIdleNWorkers()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should get', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 1), [
        { name: 'foo', credential: 'bar' },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 2), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 3), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });

    it('should run with activeRequestCount order', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
      ]);

      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 3), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
    });

    it('should run with credential order when activeRequestCount is equal (1)', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 1), [
        { name: 'foo', credential: 'bar' },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 2), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 3), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });

    it('should run with credential order when activeRequestCount is equal (2)', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      broker.sync([
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 1), [
        { name: 'foo', credential: 'bar' },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 2), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 3), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });

    it('should get when has non-valid', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
        if (worker.name === 'foo') {
          worker.updateWorkerStatusByReport(
            WorkerStatusReport.ContainerDisconnected
          );
        }
      });

      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.mostIdleNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });
  });

  describe('.newestNWorkers()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should get', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 1), [
        { name: 'foo', credential: 'bar' },
      ]);
      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 2), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 3), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });

    it('should run with registerTime order', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);

      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      broker.sync([
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 1), [
        { name: 'foo', credential: 'bar' },
      ]);
      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 2), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 3), [
        {
          name: 'foo',
          credential: 'bar',
        },
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });

    it('should get when has non-valid', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
        if (worker.name === 'foo') {
          worker.updateWorkerStatusByReport(
            WorkerStatusReport.ContainerDisconnected
          );
        }
      });

      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.newestNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });
  });

  describe('.oldestNWorkers()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should get', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 3), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
    });

    it('should run with registerTime order', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      });

      broker.sync([
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 3), [
        {
          name: 'hello',
          credential: 'world',
        },
        {
          name: 'foo',
          credential: 'bar',
        },
      ]);
    });

    it('should get when has non-valid', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        },
      ]);

      // 更新到运行状态
      broker.workers.forEach(worker => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
        if (worker.name === 'foo') {
          worker.updateWorkerStatusByReport(
            WorkerStatusReport.ContainerDisconnected
          );
        }
      });

      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 1), [
        { name: 'hello', credential: 'world' },
      ]);
      assert.deepStrictEqual(defaultController.oldestNWorkers(broker, 2), [
        {
          name: 'hello',
          credential: 'world',
        },
      ]);
    });
  });

  describe('.shrinkDraw()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should use default strategy LCC', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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
        .getWorker('hello')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('foo')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        },
      ]);

      const workers = defaultController.shrinkDraw(broker, 1);

      assert.strictEqual(workers.length, 1);
      assert.strictEqual(workers[0].name, 'foo');
    });

    it('should use default strategy LCC when worker strategy not supported', () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);
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
        .getWorker('hello')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('foo')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
      ]);

      sinon.stub(broker.profile.worker, 'shrinkStrategy').value('NOTSUPPORTED');

      const workers = defaultController.shrinkDraw(broker, 1);

      assert.strictEqual(workers.length, 1);
      assert.strictEqual(workers[0].name, 'hello');
    });

    it('should use worker strategy FIFO', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);

      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('hello')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('foo')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        },
      ]);

      sinon.stub(broker.profile.worker, 'shrinkStrategy').value('FIFO');

      const workers = defaultController.shrinkDraw(broker, 1);

      assert.strictEqual(workers.length, 1);
      assert.strictEqual(workers[0].name, 'hello');
    });

    it('should use worker strategy FILO', async () => {
      const broker = new Broker(functionProfile.getProfile('func')!, true);

      registerWorkers(broker, [
        {
          processName: 'hello',
          credential: 'world',
        },
      ]);
      await sleep(100);
      registerWorkers(broker, [
        {
          processName: 'foo',
          credential: 'bar',
        },
      ]);

      broker
        .getWorker('hello')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      broker
        .getWorker('foo')
        ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      broker.sync([
        {
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        },
        {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 8,
        },
      ]);

      sinon.stub(broker.profile.worker, 'shrinkStrategy').value('FILO');

      const workers = defaultController.shrinkDraw(broker, 1);

      assert.strictEqual(workers.length, 1);
      assert.strictEqual(workers[0].name, 'foo');
    });
  });
});
