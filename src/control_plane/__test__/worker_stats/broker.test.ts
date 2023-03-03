import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import { Broker } from '#self/control_plane/worker_stats/index';
import * as common from '#self/test/common';
import { config } from '#self/config';
import {
  FunctionProfileManager as ProfileManager,
  FunctionProfileManagerContext,
  FunctionProfileUpdateEvent,
} from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import {
  AworkerFunctionProfile,
  ShrinkStrategy,
} from '#self/lib/json/function_profile';
import {
  ContainerStatus,
  ContainerStatusReport,
  ControlPlaneEvent,
  TurfStatusEvent,
} from '#self/lib/constants';
import sinon from 'sinon';
import { sleep } from '#self/lib/util';
import {
  NoopContainer,
  registerBrokerContainers,
  TestContainerManager,
} from '../test_container_manager';
import { registerWorkers } from '../util';
import { DependencyContext } from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';

describe(common.testName(__filename), () => {
  const funcData: AworkerFunctionProfile[] = [
    {
      name: 'func',
      url: `file://${__dirname}`,
      runtime: 'aworker',
      signature: 'xxx',
      sourceFile: 'index.js',
      resourceLimit: {
        cpu: 1,
        memory: 512000000,
      },
    },
  ];

  const funcDataWithDefault = {
    ...funcData[0],
    worker: {
      fastFailRequestsOnStarting: false,
      initializationTimeout: 10000,
      maxActivateRequests: 10,
      replicaCountLimit: 10,
      reservationCount: 0,
      shrinkStrategy: 'LCC',
      v8Options: [],
      execArgv: [],
    },
  };

  let profileManager: ProfileManager | null;
  beforeEach(async () => {
    const ctx = new DependencyContext<FunctionProfileManagerContext>();
    ctx.bindInstance('config', config);
    ctx.bindInstance('eventBus', new EventBus([FunctionProfileUpdateEvent]));
    profileManager = new ProfileManager(ctx);
    await profileManager.set(funcData, 'WAIT');
  });
  afterEach(() => {
    profileManager = null;
    mm.restore();
  });

  describe('Broker', () => {
    describe('constructor', () => {
      it('should constructor', () => {
        const broker = new Broker(profileManager!, config, 'foo', true, false);
        assert.strictEqual(broker.redundantTimes, 0);
        assert.strictEqual(broker.config, config);
        assert.strictEqual(broker.profiles, profileManager);
        assert.strictEqual(broker.name, 'foo');
        assert.strictEqual(broker.isInspector, true);
        assert.strictEqual(broker.data, null);
        assert.strictEqual(broker.workers.size, 0);
        assert.strictEqual(broker.startingPool.size, 0);
      });

      it('should constructor with function profile', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
        assert.strictEqual(broker.redundantTimes, 0);
        assert.strictEqual(broker.config, config);
        assert.strictEqual(broker.profiles, profileManager);
        assert.strictEqual(broker.name, 'func');
        assert.strictEqual(broker.isInspector, true);
        assert.deepStrictEqual(broker.data, funcDataWithDefault);
        assert.strictEqual(broker.workers.size, 0);
        assert.strictEqual(broker.startingPool.size, 0);
      });
    });

    describe('.getWorker()', () => {
      it('should get worker', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
        registerWorkers(broker, [
          {
            processName: 'hello',
            credential: 'world',
          },
        ]);

        assert.strictEqual(broker.getWorker('hello')!.credential, 'world');
        assert.strictEqual(broker.getWorker('foo'), null);
      });
    });

    describe('.register()', () => {
      it('should register', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
        registerWorkers(broker, [
          {
            processName: 'foo',
            credential: 'bar',
          },
        ]);

        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker.startingPool.size, 1);

        const worker = JSON.parse(JSON.stringify(broker.getWorker('foo')));
        assert.deepStrictEqual(worker, {
          containerStatus: ContainerStatus.Created,
          turfContainerStates: null,
          name: 'foo',
          credential: 'bar',
          pid: null,
          data: null,
          registerTime: worker.registerTime,
        });
        assert.deepStrictEqual(broker.startingPool.get('foo'), {
          credential: 'bar',
          estimateRequestLeft: 10,
          maxActivateRequests: 10,
        });
      });

      it('should not register', () => {
        const broker = new Broker(profileManager!, config, 'foo', true, false);

        assert.throws(
          () => {
            registerWorkers(broker, [
              {
                processName: 'foo',
                credential: 'bar',
              },
            ]);
          },
          {
            message: /No function profile named foo\./,
          }
        );
      });
    });

    describe('.removeItemFromStartingPool()', () => {
      it('should removeItemFromStartingPool', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);

        registerWorkers(broker, [
          {
            processName: 'foo',
            credential: 'bar',
          },
        ]);
        broker.removeItemFromStartingPool('foo');

        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker.startingPool.size, 0);
      });
    });

    describe('.prerequestStartingPool()', () => {
      it('should return false when startingPool is empty', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
        assert.strictEqual(broker.prerequestStartingPool(), false);
      });

      it('should return true when idle and false when busy', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);

        registerWorkers(broker, [
          {
            processName: 'coco',
            credential: 'nut',
          },
        ]);
        for (let i = 0; i < 20; i++) {
          assert.strictEqual(broker.prerequestStartingPool(), i < 10);
        }
      });

      it('should return true when idle and false when busy with two items', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);

        registerWorkers(broker, [
          {
            processName: 'coco',
            credential: 'nut',
          },
          {
            processName: 'alibaba',
            credential: 'seed of hope',
          },
        ]);
        for (let i = 0; i < 40; i++) {
          assert.strictEqual(broker.prerequestStartingPool(), i < 20);
        }
      });
    });

    describe('.mostIdleNWorkers()', () => {
      it('should get', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
          );
        });

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [
          { name: 'foo', credential: 'bar' },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'foo',
            credential: 'bar',
          },
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
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

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
          {
            name: 'foo',
            credential: 'bar',
          },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
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

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [
          { name: 'foo', credential: 'bar' },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'foo',
            credential: 'bar',
          },
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
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

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [
          { name: 'foo', credential: 'bar' },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'foo',
            credential: 'bar',
          },
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          if (worker.name === 'foo') {
            worker.updateContainerStatus(
              ContainerStatus.Stopped,
              TurfStatusEvent.StatusStopped
            );
          } else {
            worker.updateContainerStatus(
              ContainerStatus.Ready,
              ContainerStatusReport.ContainerInstalled
            );
          }
        });

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
      });
    });

    describe('.newestNWorkers()', () => {
      it('should get', async () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
          );
        });

        assert.deepStrictEqual(broker.newestNWorkers(1), [
          { name: 'foo', credential: 'bar' },
        ]);
        assert.deepStrictEqual(broker.newestNWorkers(2), [
          {
            name: 'foo',
            credential: 'bar',
          },
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
        assert.deepStrictEqual(broker.newestNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
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

        assert.deepStrictEqual(broker.newestNWorkers(1), [
          { name: 'foo', credential: 'bar' },
        ]);
        assert.deepStrictEqual(broker.newestNWorkers(2), [
          {
            name: 'foo',
            credential: 'bar',
          },
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
        assert.deepStrictEqual(broker.newestNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          if (worker.name === 'foo') {
            worker.updateContainerStatus(
              ContainerStatus.Stopped,
              TurfStatusEvent.StatusStopped
            );
          } else {
            worker.updateContainerStatus(
              ContainerStatus.Ready,
              ContainerStatusReport.ContainerInstalled
            );
          }
        });

        assert.deepStrictEqual(broker.newestNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.newestNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
      });
    });

    describe('.oldestNWorkers()', () => {
      it('should get', async () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
          );
        });

        assert.deepStrictEqual(broker.oldestNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.oldestNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
          {
            name: 'foo',
            credential: 'bar',
          },
        ]);
        assert.deepStrictEqual(broker.oldestNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          worker.updateContainerStatus(
            ContainerStatus.Ready,
            ContainerStatusReport.ContainerInstalled
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

        assert.deepStrictEqual(broker.oldestNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.oldestNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
          {
            name: 'foo',
            credential: 'bar',
          },
        ]);
        assert.deepStrictEqual(broker.oldestNWorkers(3), [
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
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
          if (worker.name === 'foo') {
            worker.updateContainerStatus(
              ContainerStatus.Stopped,
              TurfStatusEvent.StatusStopped
            );
          } else {
            worker.updateContainerStatus(
              ContainerStatus.Ready,
              ContainerStatusReport.ContainerInstalled
            );
          }
        });

        assert.deepStrictEqual(broker.oldestNWorkers(1), [
          { name: 'hello', credential: 'world' },
        ]);
        assert.deepStrictEqual(broker.oldestNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
        ]);
      });
    });

    describe('.evaluateWaterLevel()', () => {
      it('should evaluate when some worker stopped (low)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        // TODO: 这么做不合法，需要调整测试用例
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 50,
            activeRequestCount: 50,
          },
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]);
        // 更新运行状态
        broker.workers.forEach(worker => {
          if (worker.name === 'hello') {
            worker.updateContainerStatus(
              ContainerStatus.Stopped,
              TurfStatusEvent.StatusStopped
            );
          }
        });
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate when some worker stopped (high)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 50,
            activeRequestCount: 50,
          },
          {
            name: 'foo',
            maxActivateRequests: 100,
            activeRequestCount: 0,
          },
        ]);
        broker.workers.forEach(worker => {
          if (worker.name === 'foo') {
            worker.updateContainerStatus(
              ContainerStatus.Stopped,
              TurfStatusEvent.StatusStopped
            );
          }
        });
        assert.strictEqual(broker.evaluateWaterLevel(), 3);
      });

      it('should evaluate with starting pool, ignore in start pool', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 5,
          },
        ]);
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate with starting pool (high)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 10,
          },
        ]);

        // for (let i = 0; i < 10; i++) assert(broker.prerequestStartingPool());

        assert.strictEqual(broker.evaluateWaterLevel(), 1);
      });

      it('should evaluate water level', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level without broker data', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );

        registerWorkers(broker, [
          {
            processName: 'hello',
            credential: 'world',
          },
        ]);
        broker.data = null;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level without broker data and expansionOnly = true', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );

        registerWorkers(broker, [
          {
            processName: 'hello',
            credential: 'world',
          },
        ]);
        broker.data = null;
        assert.strictEqual(broker.evaluateWaterLevel(true), 0);
      });

      it('should evaluate water level with one worker left', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );

        registerWorkers(broker, [
          {
            processName: 'hello',
            credential: 'world',
          },
        ]);

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          },
        ]);

        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level (still redundant, high)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 8,
          },
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 8,
          },
        ]);
        assert.strictEqual(broker.evaluateWaterLevel(), 1);
      });

      it('should evaluate water level (still redundant, low)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]);
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level (low 1)', async () => {
        await profileManager!.set(
          [{ ...funcData[0], worker: { reservationCount: 1 } }],
          'WAIT'
        );
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]);
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low 2)', async () => {
        await profileManager!.set(
          [{ ...funcData[0], worker: { reservationCount: 1 } }],
          'WAIT'
        );
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 3,
            trafficOff: false,
          } as any,
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 3,
          },
        ]);
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low 1, no reservation)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          } as any,
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          },
        ]);
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -2);
      });

      it('should evaluate water level (low 2, no reservation)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 3,
          } as any,
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 3,
          },
        ]);
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low, expansionOnly)', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 3,
            activeRequestCount: 0,
          } as any,
          {
            name: 'foo',
            maxActivateRequests: 3,
            activeRequestCount: 0,
          },
        ]);
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(true), 0);
      });

      it('should reset redundantTimes', () => {
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
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

        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          } as any,
          {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          },
        ]);

        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
        assert.strictEqual(broker.redundantTimes, 0);
      });

      it('should evaluate (high with several workers)', async () => {
        await profileManager!.set(
          [{ ...funcData[0], worker: { replicaCountLimit: 50 } }] as any,
          'WAIT'
        );
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
        const mocked = [];
        for (let i = 0; i < 20; i++) {
          mocked.push({
            name: String(i),
            maxActivateRequests: 10,
            activeRequestCount: 10,
          });
          registerWorkers(broker, [
            {
              processName: String(i),
              credential: String(i),
              funcName: 'func',
            },
          ]);

          broker.updateWorkerContainerStatus(
            String(i),
            ContainerStatus.Ready,
            ControlPlaneEvent.RequestQueueExpand
          );
        }
        broker.sync(mocked);
        assert.strictEqual(broker.evaluateWaterLevel(), 9);
      });

      it('should evaluate (high with several workers, up to replicaCountLimit)', async () => {
        await profileManager!.set(
          [{ ...funcData[0], worker: { replicaCountLimit: 25 } }] as any,
          'WAIT'
        );
        const broker = new Broker(
          profileManager!,
          config,
          'func',
          false,
          false
        );
        const mocked = [];
        for (let i = 0; i < 20; i++) {
          mocked.push({
            name: String(i),
            maxActivateRequests: 10,
            activeRequestCount: 10,
          });
          registerWorkers(broker, [
            {
              processName: String(i),
              credential: String(i),
              funcName: 'func',
            },
          ]);
          broker.updateWorkerContainerStatus(
            String(i),
            ContainerStatus.Ready,
            ControlPlaneEvent.RequestQueueExpand
          );
        }
        broker.sync(mocked);
        assert.strictEqual(broker.evaluateWaterLevel(), 5);
      });
    });

    describe('getters', () => {
      let broker: Broker;
      beforeEach(() => {
        broker = new Broker(profileManager!, config, 'func', false, false);
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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
      });

      describe('.belongsToFunctionProfile()', () => {
        it('should belong', async () => {
          assert.strictEqual(broker.belongsToFunctionProfile(), true);
          await profileManager!.set([], 'WAIT');
          broker.sync([]);
          assert.strictEqual(broker.belongsToFunctionProfile(), false);
        });
      });

      describe('get .workerCount()', () => {
        it('should get when no startingPool', () => {
          assert.strictEqual(broker.workerCount, 2);
        });

        it('should not get in having startingPool', () => {
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'world',
            },
          ]);
          assert.strictEqual(broker.workerCount, 2);
        });

        it('should get when having stopped', () => {
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
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
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateContainerStatus(
                ContainerStatus.Stopped,
                TurfStatusEvent.StatusStopped
              );
            }
          });

          assert.strictEqual(broker.workerCount, 1);
        });
      });

      describe('get .virtualMemory()', () => {
        it('should get virtualMemory with startingPool, ignore in startingPool', () => {
          assert.strictEqual(broker.virtualMemory, 1024000000);
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
            },
          ]);
          assert.strictEqual(broker.virtualMemory, 1024000000);
        });

        it('should get virtualMemory', () => {
          assert.strictEqual(broker.virtualMemory, 1024000000);

          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
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
            {
              name: 'coco',
              maxActivateRequests: 10,
              activeRequestCount: 0,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateContainerStatus(
                ContainerStatus.Stopped,
                TurfStatusEvent.StatusStopped
              );
            }
          });
          assert.strictEqual(broker.virtualMemory, 512000000);
        });
      });

      describe('get .totalMaxActivateRequests()', () => {
        it('should get totalMaxActivateRequests', () => {
          assert.strictEqual(broker.totalMaxActivateRequests, 20);
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
            },
          ]);
          assert.strictEqual(broker.totalMaxActivateRequests, 20);

          broker.updateWorkerContainerStatus(
            'coco',
            ContainerStatus.Ready,
            ControlPlaneEvent.RequestQueueExpand
          );

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
            {
              name: 'coco',
              maxActivateRequests: 10,
              activeRequestCount: 0,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateContainerStatus(
                ContainerStatus.Stopped,
                TurfStatusEvent.StatusStopped
              );
            }
          });
          assert.strictEqual(broker.totalMaxActivateRequests, 20);
        });
      });

      describe('get .activeRequestCount()', () => {
        it('should get activeRequestCount', () => {
          assert.strictEqual(broker.activeRequestCount, 11);
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
            },
          ]);
          assert.strictEqual(broker.activeRequestCount, 11);

          broker.updateWorkerContainerStatus(
            'coco',
            ContainerStatus.Ready,
            ControlPlaneEvent.RequestQueueExpand
          );

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
            {
              name: 'coco',
              maxActivateRequests: 10,
              activeRequestCount: 2,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateContainerStatus(
                ContainerStatus.Stopped,
                TurfStatusEvent.StatusStopped
              );
            }
          });
          assert.strictEqual(broker.activeRequestCount, 6);
        });
      });

      describe('get #waterLevel()', () => {
        it('should get waterLevel', () => {
          assert.strictEqual(broker.waterLevel, 0.55);
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
            },
          ]);
          assert.strictEqual(broker.waterLevel, 0.55);

          broker.updateWorkerContainerStatus(
            'coco',
            ContainerStatus.Ready,
            ControlPlaneEvent.RequestQueueExpand
          );

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
            {
              name: 'coco',
              maxActivateRequests: 10,
              activeRequestCount: 2,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateContainerStatus(
                ContainerStatus.Stopped,
                TurfStatusEvent.StatusStopped
              );
            }
          });

          assert.strictEqual(broker.waterLevel, 0.3);
        });
      });

      describe('get reservationCount', () => {
        it('should get 1 when isInspector is true', () => {
          broker = new Broker(profileManager!, config, 'func', true, false);

          assert.strictEqual(broker.reservationCount, 1);
        });

        it('should get from worker config', () => {
          broker = new Broker(profileManager!, config, 'func', false, false);

          broker.data = {
            ...funcData[0],
            worker: {
              fastFailRequestsOnStarting: false,
              initializationTimeout: 10000,
              maxActivateRequests: 10,
              replicaCountLimit: 10,
              reservationCount: 10,
              shrinkStrategy: 'LCC',
              v8Options: [],
              execArgv: [],
            },
          };

          assert.strictEqual(broker.reservationCount, 10);
        });

        it('should get 0 when worker not config', () => {
          broker = new Broker(profileManager!, config, 'func', false, false);

          broker.data = {
            ...funcData[0],
            worker: {
              fastFailRequestsOnStarting: false,
              initializationTimeout: 10000,
              maxActivateRequests: 10,
              replicaCountLimit: 10,
              shrinkStrategy: 'LCC',
              v8Options: [],
              execArgv: [],
            },
          };

          assert.strictEqual(broker.reservationCount, 0);

          broker.data = funcData[0];

          assert.strictEqual(broker.reservationCount, 0);

          broker.data = null;

          assert.strictEqual(broker.reservationCount, 0);
        });
      });

      describe('get memoryLimit', () => {
        it('should get from worker config', () => {
          broker = new Broker(profileManager!, config, 'func', false, false);

          broker.data = {
            ...funcData[0],
            worker: {
              fastFailRequestsOnStarting: false,
              initializationTimeout: 10000,
              maxActivateRequests: 10,
              replicaCountLimit: 10,
              reservationCount: 10,
              shrinkStrategy: 'LCC',
              v8Options: [],
              execArgv: [],
            },
            resourceLimit: {
              memory: 100,
            },
          };

          assert.strictEqual(broker.memoryLimit, 100);
        });

        it('should get 0 when worker not config', () => {
          broker = new Broker(profileManager!, config, 'func', false, false);

          broker.data = {
            ...funcData[0],
            worker: {
              fastFailRequestsOnStarting: false,
              initializationTimeout: 10000,
              maxActivateRequests: 10,
              replicaCountLimit: 10,
              shrinkStrategy: 'LCC',
              v8Options: [],
              execArgv: [],
            },
            resourceLimit: {},
          };

          assert.strictEqual(broker.memoryLimit, 0);

          delete broker.data.resourceLimit;

          assert.strictEqual(broker.memoryLimit, 0);

          broker.data = null;

          assert.strictEqual(broker.memoryLimit, 0);
        });
      });
    });

    describe('.sync()', () => {
      it('should sync', () => {
        const testContainerManager = new TestContainerManager();
        const broker = new Broker(profileManager!, config, 'func', true, false);
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        registerBrokerContainers(testContainerManager, broker, [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ]);
        testContainerManager.reconcileContainers();
        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          },
          {
            name: 'non-exists',
            maxActivateRequests: 10,
            activeRequestCount: 1,
          },
        ]);

        assert.strictEqual(broker.startingPool.size, 1);
        assert.deepStrictEqual(broker.startingPool.get('foo'), {
          credential: 'bar',
          estimateRequestLeft: 10,
          maxActivateRequests: 10,
        });

        assert.strictEqual(broker.workers.size, 2);
        assert.deepStrictEqual(broker.data, funcDataWithDefault);
        const workers = [
          {
            containerStatus: ContainerStatus.Ready,
            turfContainerStates: TurfContainerStates.running,
            name: 'hello',
            credential: 'world',
            pid: 2,
            data: {
              maxActivateRequests: 10,
              activeRequestCount: 7,
            },
          },
          {
            containerStatus: ContainerStatus.Created,
            turfContainerStates: TurfContainerStates.running,
            name: 'foo',
            credential: 'bar',
            pid: 1,
            data: null,
          },
        ];
        const realWorkers = [
          broker.getWorker('hello')!.toJSON(),
          broker.getWorker('foo')!.toJSON(),
        ];
        for (let i = 0; i < workers.length; i++) {
          assert.deepStrictEqual(
            _.omit(JSON.parse(JSON.stringify(realWorkers[i])), [
              'registerTime',
            ]),
            workers[i]
          );
        }
      });

      it('should sync with no function profile', async () => {
        const testContainerManager = new TestContainerManager();
        const broker = new Broker(profileManager!, config, 'func', true, false);
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

        await profileManager!.set([], 'WAIT');

        registerBrokerContainers(testContainerManager, broker, [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ]);
        testContainerManager.reconcileContainers();
        broker.sync([
          {
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          },
          {
            name: 'non-exists',
            maxActivateRequests: 10,
            activeRequestCount: 1,
          },
        ]);

        assert.strictEqual(broker.startingPool.size, 1);
        assert.deepStrictEqual(broker.startingPool.get('foo'), {
          credential: 'bar',
          estimateRequestLeft: 10,
          maxActivateRequests: 10,
        });

        assert.strictEqual(broker.workers.size, 2);
        assert.deepStrictEqual(broker.data, null);
        const workers = [
          {
            containerStatus: ContainerStatus.Ready,
            turfContainerStates: TurfContainerStates.running,
            name: 'hello',
            credential: 'world',
            pid: 2,
            data: {
              maxActivateRequests: 10,
              activeRequestCount: 7,
            },
          },
          {
            containerStatus: ContainerStatus.Created,
            turfContainerStates: TurfContainerStates.running,
            name: 'foo',
            credential: 'bar',
            pid: 1,
            data: null,
          },
        ];
        const realWorkers = [
          broker.getWorker('hello')!,
          broker.getWorker('foo')!,
        ];
        for (let i = 0; i < workers.length; i++) {
          assert.deepStrictEqual(
            _.omit(realWorkers[i].toJSON(), ['registerTime']),
            workers[i]
          );
        }
      });
    });

    describe('.shrinkDraw()', () => {
      it('should use default strategy LCC', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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
        broker.data = null;

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'foo');
      });

      it('should use default strategy LCC when worker strategy not supported', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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

        broker.data = {
          ...funcData[0],
          worker: {
            fastFailRequestsOnStarting: false,
            initializationTimeout: 10000,
            maxActivateRequests: 10,
            replicaCountLimit: 10,
            reservationCount: 0,
            shrinkStrategy: 'NOTSUPPORTED' as ShrinkStrategy,
            v8Options: [],
            execArgv: [],
          },
        };

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'hello');
      });

      it('should use default strategy LCC when worker strategy is empty', () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);
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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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

        broker.data = {
          ...funcData[0],
          worker: {
            fastFailRequestsOnStarting: false,
            initializationTimeout: 10000,
            maxActivateRequests: 10,
            replicaCountLimit: 10,
            reservationCount: 0,
            shrinkStrategy: undefined,
            v8Options: [],
            execArgv: [],
          },
        };

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'hello');
      });

      it('should use worker strategy FIFO', async () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);

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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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

        broker.data = {
          ...funcData[0],
          worker: {
            fastFailRequestsOnStarting: false,
            initializationTimeout: 10000,
            maxActivateRequests: 10,
            replicaCountLimit: 10,
            reservationCount: 0,
            shrinkStrategy: 'FIFO',
            v8Options: [],
            execArgv: [],
          },
        };

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'hello');
      });

      it('should use worker strategy FILO', async () => {
        const broker = new Broker(profileManager!, config, 'func', true, false);

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

        broker.updateWorkerContainerStatus(
          'hello',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );
        broker.updateWorkerContainerStatus(
          'foo',
          ContainerStatus.Ready,
          ControlPlaneEvent.RequestQueueExpand
        );

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

        broker.data = {
          ...funcData[0],
          worker: {
            fastFailRequestsOnStarting: false,
            initializationTimeout: 10000,
            maxActivateRequests: 10,
            replicaCountLimit: 10,
            reservationCount: 0,
            shrinkStrategy: 'FILO',
            v8Options: [],
            execArgv: [],
          },
        };

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'foo');
      });
    });
  });
});
