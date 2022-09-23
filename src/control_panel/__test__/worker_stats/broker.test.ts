import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import { Broker, Worker } from '#self/control_panel/worker_stats/index';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { FunctionProfileManager as ProfileManager } from '#self/lib/function_profile';
import { turf, TurfContainerStates } from '#self/lib/turf';
import { ServerlessWorkerFunctionProfile, ShrinkStrategy } from '#self/lib/json/function_profile';
import { ContainerStatus } from '#self/lib/constants';
import sinon from 'sinon';
import pedding from 'pedding';
import { performance } from 'perf_hooks';
import { sleep } from '#self/lib/util';

describe(common.testName(__filename), () => {
  const funcData: ServerlessWorkerFunctionProfile[] = [{
    name: 'func',
    url: `file://${__dirname}`,
    runtime: 'aworker',
    signature: 'xxx',
    sourceFile: 'index.js',
    resourceLimit: {
      cpu: 1,
      memory: 512000000,
    },
  }];

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
    profileManager = new ProfileManager(config);
    await profileManager.set(funcData, 'WAIT');
  });
  afterEach(() => {
    profileManager = null;
    mm.restore();
  });

  describe('Broker', () => {
    describe('constructor', () => {
      it('should constructor', () => {
        const broker = new Broker(profileManager!, config, 'foo', true);
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
        const broker = new Broker(profileManager!, config, 'func', true);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');

        assert.strictEqual(broker.getWorker('hello')!.credential, 'world');
        assert.strictEqual(broker.getWorker('foo'), null);
      });
    });

    describe('.register()', () => {
      it('should register', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('foo', 'bar');

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
        const broker = new Broker(profileManager!, config, 'foo', true);

        assert.throws(() => {
          broker.register('foo', 'bar');
        }, {
          message: /No function profile named foo\./,
        });
      });
    });

    describe('.unregister()', () => {
      it('should unregister without destroy', () => {
        const spy = sinon.spy(turf, 'destroy');

        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('foo', 'bar');
        broker.unregister('foo');

        assert.strictEqual(broker.workers.size, 0);
        assert.strictEqual(broker.startingPool.size, 0);

        assert(!spy.called);

        spy.restore();
      });

      it('should unregister with destroy', (done) => {
        done = pedding(2, done);

        const stub = sinon.stub(turf, 'destroy').callsFake(async (name: string) => {
          assert.strictEqual(name, 'foo');
          done();
        });

        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('foo', 'bar');
        broker.unregister('foo', true);

        assert.strictEqual(broker.workers.size, 0);
        assert.strictEqual(broker.startingPool.size, 0);

        stub.restore();
        done();
      });

      it('should unregister with destroy error catched', (done) => {
        done = pedding(3, done);

        const stub = sinon.stub(turf, 'destroy').callsFake(async (name: string) => {
          assert.strictEqual(name, 'foo');
          done();
          throw new Error('should be catched.');
        });

        const broker = new Broker(profileManager!, config, 'func', true);

        const spy = sinon.spy(broker.logger, 'warn');

        broker.register('foo', 'bar');
        broker.unregister('foo', true);

        assert.strictEqual(broker.workers.size, 0);
        assert.strictEqual(broker.startingPool.size, 0);

        setTimeout(() => {
          // wait turf.destory catch
          assert(spy.calledWithMatch(/Failed to destroy/));
          spy.restore();
          done();
        }, 100);

        stub.restore();
        done();
      });

      it('should not unregister', (done) => {
        done = pedding(2, done);

        const stub = sinon.stub(turf, 'destroy').callsFake(async (name: string) => {
          assert.strictEqual(name, 'fooo');
          done();
        });

        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('foo', 'bar');
        broker.unregister('fooo', true);

        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker.startingPool.size, 1);

        stub.restore();
        done();
      });
    });

    describe('.removeItemFromStartingPool()', () => {
      it('should removeItemFromStartingPool', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('foo', 'bar');
        broker.removeItemFromStartingPool('foo');

        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker.startingPool.size, 0);
      });
    });

    describe('.prerequestStartingPool()', () => {
      it('should return false when startingPool is empty', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        assert.strictEqual(broker.prerequestStartingPool(), false);
      });

      it('should return true when idle and false when busy', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('coco', 'nut');
        for (let i = 0; i < 20; i++) {
          assert.strictEqual(broker.prerequestStartingPool(), i < 10);
        }
      });

      it('should return true when idle and false when busy with two items', () => {
        const broker = new Broker(profileManager!, config, 'func', true);

        broker.register('coco', 'nut');
        broker.register('alibaba', 'seed of hope');
        for (let i = 0; i < 40; i++) {
          assert.strictEqual(broker.prerequestStartingPool(), i < 20);
        }
      });
    });

    describe('.mostIdleNWorkers()', () => {
      it('should get', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
        });

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [{ name: 'foo', credential: 'bar' }]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [{
          name: 'foo',
          credential: 'bar',
        }, {
          name: 'hello',
          credential: 'world',
        }]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [{
          name: 'foo',
          credential: 'bar',
        }, {
          name: 'hello',
          credential: 'world',
        }]);
      });

      it('should run with activeRequestCount order', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
        });

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [{ name: 'hello', credential: 'world' }]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [
          {
            name: 'hello',
            credential: 'world',
          },
          {
            name: 'foo',
            credential: 'bar',
          }
        ]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(3), [
          {
            name: 'hello',
            credential: 'world',
          },
          {
            name: 'foo',
            credential: 'bar',
          }
        ]);
      });

      it('should run with credential order when activeRequestCount is equal (1)', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
        });

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [{ name: 'foo', credential: 'bar' }]);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
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
          }
        ], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [{ name: 'foo', credential: 'bar' }]);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.stopped },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          if (worker.turfContainerStates === TurfContainerStates.stopped) {
            worker.updateContainerStatus(ContainerStatus.Stopped, performance.now());
          } else {
            worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
          }
        });

        assert.deepStrictEqual(broker.mostIdleNWorkers(1), [{ name: 'hello', credential: 'world' }]);
        assert.deepStrictEqual(broker.mostIdleNWorkers(2), [{
          name: 'hello',
          credential: 'world',
        }]);
      });
    });

    describe('.newestNWorkers()', () => {
      it('should get', async () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
        });

        assert.deepStrictEqual(broker.newestNWorkers(1), [{ name: 'foo', credential: 'bar' }]);
        assert.deepStrictEqual(broker.newestNWorkers(2), [{
          name: 'foo',
          credential: 'bar',
        }, {
          name: 'hello',
          credential: 'world',
        }]);
        assert.deepStrictEqual(broker.newestNWorkers(3), [{
          name: 'foo',
          credential: 'bar',
        }, {
          name: 'hello',
          credential: 'world',
        }]);
      });

      it('should run with registerTime order', async () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
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
          }
        ], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.deepStrictEqual(broker.newestNWorkers(1), [{ name: 'foo', credential: 'bar' }]);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.stopped },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          if (worker.turfContainerStates === TurfContainerStates.stopped) {
            worker.updateContainerStatus(ContainerStatus.Stopped, performance.now());
          } else {
            worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
          }
        });

        assert.deepStrictEqual(broker.newestNWorkers(1), [{ name: 'hello', credential: 'world' }]);
        assert.deepStrictEqual(broker.newestNWorkers(2), [{
          name: 'hello',
          credential: 'world',
        }]);
      });
    });

    describe('.oldestNWorkers()', () => {
      it('should get', async () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
        });

        assert.deepStrictEqual(broker.oldestNWorkers(1), [{ name: 'hello', credential: 'world' }]);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
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
          }
        ], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.deepStrictEqual(broker.oldestNWorkers(1), [{ name: 'hello', credential: 'world' }]);
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.stopped },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // 更新到运行状态
        broker.workers.forEach((worker) => {
          if (worker.turfContainerStates === TurfContainerStates.stopped) {
            worker.updateContainerStatus(ContainerStatus.Stopped, performance.now());
          } else {
            worker.updateContainerStatus(ContainerStatus.Ready, performance.now());
          }
        });

        assert.deepStrictEqual(broker.oldestNWorkers(1), [{ name: 'hello', credential: 'world' }]);
        assert.deepStrictEqual(broker.oldestNWorkers(2), [{
          name: 'hello',
          credential: 'world',
        }]);
      });
    });

    describe('.evaluateWaterLevel()', () => {
      it('should evaluate when some worker stopped (low)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 50,
          activeRequestCount: 50,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate when some worker stopped (high)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 50,
          activeRequestCount: 50,
        }, {
          name: 'foo',
          maxActivateRequests: 100,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.stopped },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 3);
      });

      it('should evaluate with starting pool, ignore in start pool', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        // 只启动一个
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 5,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate with starting pool (high)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 10,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        // for (let i = 0; i < 10; i++) assert(broker.prerequestStartingPool());

        assert.strictEqual(broker.evaluateWaterLevel(), 1);
      });

      it('should evaluate water level', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level without broker data', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.data = null;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level without broker data and expansionOnly = true', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.data = null;
        assert.strictEqual(broker.evaluateWaterLevel(true), 0);
      });

      it('should evaluate water level with one worker left', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level (still redundant, high)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 8,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 8,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 1);
      });

      it('should evaluate water level (still redundant, low)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
      });

      it('should evaluate water level (low 1)', async () => {
        await profileManager!.set([{ ...funcData[0], worker: { reservationCount: 1 } }], 'WAIT');
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low 2)', async () => {
        await profileManager!.set([{ ...funcData[0], worker: { reservationCount: 1 } }], 'WAIT');
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 3,
          trafficOff: false,
        } as any, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 3,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low 1, no reservation)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        } as any, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -2);
      });

      it('should evaluate water level (low 2, no reservation)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 3,
        } as any, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 3,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), -1);
      });

      it('should evaluate water level (low, expansionOnly)', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 3,
          activeRequestCount: 0,
        } as any, {
          name: 'foo',
          maxActivateRequests: 3,
          activeRequestCount: 0,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(true), 0);
      });

      it('should reset redundantTimes', () => {
        const broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        } as any, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        broker.redundantTimes = 60;
        assert.strictEqual(broker.evaluateWaterLevel(), 0);
        assert.strictEqual(broker.redundantTimes, 0);
      });

      it('should evaluate (high with several workers)', async () => {
        await profileManager!.set([{ ...funcData[0], worker: { replicaCountLimit: 50 } }] as any, 'WAIT');
        const broker = new Broker(profileManager!, config, 'func', false);
        const mocked = [];
        const turfItems = [];
        for (let i = 0; i < 20; i++) {
          mocked.push({
            name: String(i),
            maxActivateRequests: 10,
            activeRequestCount: 10,
          });
          broker.register(String(i), String(i));

          broker.updateWorkerContainerStatus(String(i), ContainerStatus.Ready);
          turfItems.push({ pid: i, name: String(i), status: TurfContainerStates.running });
        }
        broker.sync(mocked, turfItems, performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 9);
      });

      it('should evaluate (high with several workers, up to replicaCountLimit)', async () => {
        await profileManager!.set([{ ...funcData[0], worker: { replicaCountLimit: 25 } }] as any, 'WAIT');
        const broker = new Broker(profileManager!, config, 'func', false);
        const mocked = [];
        const turfItems = [];
        for (let i = 0; i < 20; i++) {
          mocked.push({
            name: String(i),
            maxActivateRequests: 10,
            activeRequestCount: 10,
          });
          broker.register(String(i), String(i));
          broker.updateWorkerContainerStatus(String(i), ContainerStatus.Ready);
          turfItems.push({ pid: i, name: String(i), status: TurfContainerStates.running });
        }
        broker.sync(mocked, turfItems, performance.now());
        assert.strictEqual(broker.evaluateWaterLevel(), 5);
      });
    });

    describe('getters', () => {
      let broker: Broker;
      beforeEach(() => {
        broker = new Broker(profileManager!, config, 'func', false);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 4,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());
      });

      describe('.belongsToFunctionProfile()', () => {
        it('should belong', async () => {
          assert.strictEqual(broker.belongsToFunctionProfile(), true);
          await profileManager!.set([], 'WAIT');
          broker.sync([], [], performance.now());
          assert.strictEqual(broker.belongsToFunctionProfile(), false);
        });
      });

      describe('get .workerCount()', () => {
        it('should get when no startingPool', () => {
          assert.strictEqual(broker.workerCount, 2);
        });

        it('should not get in having startingPool', () => {
          broker.register('coco', 'nut');
          assert.strictEqual(broker.workerCount, 2);
        });

        it('should get when having stopped', () => {
          broker.register('coco', 'nut');
          broker.sync([{
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          }, {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          }], [
            { pid: 1, name: 'foo', status: TurfContainerStates.running },
            { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
          ], performance.now());

          assert.strictEqual(broker.workerCount, 1);
        });
      });

      describe('get .virtualMemory()', () => {
        it('should get virtualMemory with startingPool, ignore in startingPool', () => {
          assert.strictEqual(broker.virtualMemory, 1024000000);
          broker.register('coco', 'nut');
          assert.strictEqual(broker.virtualMemory, 1024000000);
        });

        it('should get virtualMemory', () => {
          assert.strictEqual(broker.virtualMemory, 1024000000);

          broker.register('coco', 'nut');

          broker.sync([{
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          }, {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          }, {
            name: 'coco',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          }], [
            { pid: 1, name: 'foo', status: TurfContainerStates.running },
            { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
            { pid: 3, name: 'coco', status: TurfContainerStates.running },
          ], performance.now());
          assert.strictEqual(broker.virtualMemory, 512000000);
        });
      });

      describe('get .totalMaxActivateRequests()', () => {
        it('should get totalMaxActivateRequests', () => {
          assert.strictEqual(broker.totalMaxActivateRequests, 20);
          broker.register('coco', 'nut');
          assert.strictEqual(broker.totalMaxActivateRequests, 20);

          broker.updateWorkerContainerStatus('coco', ContainerStatus.Ready);

          broker.sync([{
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          }, {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          }, {
            name: 'coco',
            maxActivateRequests: 10,
            activeRequestCount: 0,
          }], [
            { pid: 1, name: 'foo', status: TurfContainerStates.running },
            { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
            { pid: 3, name: 'coco', status: TurfContainerStates.running },
          ], performance.now());
          assert.strictEqual(broker.totalMaxActivateRequests, 20);
        });
      });

      describe('get .activeRequestCount()', () => {
        it('should get activeRequestCount', () => {
          assert.strictEqual(broker.activeRequestCount, 11);
          broker.register('coco', 'nut');
          assert.strictEqual(broker.activeRequestCount, 11);

          broker.updateWorkerContainerStatus('coco', ContainerStatus.Ready);

          broker.sync([{
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          }, {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          }, {
            name: 'coco',
            maxActivateRequests: 10,
            activeRequestCount: 2,
          }], [
            { pid: 1, name: 'foo', status: TurfContainerStates.running },
            { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
            { pid: 3, name: 'coco', status: TurfContainerStates.running },
          ], performance.now());
          assert.strictEqual(broker.activeRequestCount, 6);
        });
      });

      describe('get #waterLevel()', () => {
        it('should get waterLevel', () => {
          assert.strictEqual(broker.waterLevel, 0.55);
          broker.register('coco', 'nut');
          assert.strictEqual(broker.waterLevel, 0.55);

          broker.updateWorkerContainerStatus('coco', ContainerStatus.Ready);

          broker.sync([{
            name: 'hello',
            maxActivateRequests: 10,
            activeRequestCount: 7,
          }, {
            name: 'foo',
            maxActivateRequests: 10,
            activeRequestCount: 4,
          }, {
            name: 'coco',
            maxActivateRequests: 10,
            activeRequestCount: 2,
          }], [
            { pid: 1, name: 'foo', status: TurfContainerStates.running },
            { pid: 2, name: 'hello', status: TurfContainerStates.stopped },
            { pid: 3, name: 'coco', status: TurfContainerStates.running },
          ], performance.now());

          assert.strictEqual(broker.waterLevel, 0.3);
        });
      });

      describe('get reservationCount', () => {
        it('should get 1 when isInspector is true', () => {
          broker = new Broker(profileManager!, config, 'func', true);

          assert.strictEqual(broker.reservationCount, 1);
        });

        it('should get from worker config', () => {
          broker = new Broker(profileManager!, config, 'func', false);

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
          broker = new Broker(profileManager!, config, 'func', false);

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
          broker = new Broker(profileManager!, config, 'func', false);

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
              memory: 100
            }
          };

          assert.strictEqual(broker.memoryLimit, 100);
        });

        it('should get 0 when worker not config', () => {
          broker = new Broker(profileManager!, config, 'func', false);

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
            resourceLimit: {}
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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'non-exists',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.strictEqual(broker.startingPool.size, 1);
        assert.deepStrictEqual(broker.startingPool.get('foo'), {
          credential: 'bar',
          estimateRequestLeft: 10,
          maxActivateRequests: 10,
        });

        assert.strictEqual(broker.workers.size, 2);
        assert.deepStrictEqual(broker.data, funcDataWithDefault);
        const workers = [{
          containerStatus: ContainerStatus.Ready,
          turfContainerStates: TurfContainerStates.running,
          name: 'hello',
          credential: 'world',
          pid: 2,
          data: {
            maxActivateRequests: 10,
            activeRequestCount: 7,
          },
        }, {
          containerStatus: ContainerStatus.Created,
          turfContainerStates: TurfContainerStates.running,
          name: 'foo',
          credential: 'bar',
          pid: 1,
          data: null,
        }];
        const realWorkers = [ broker.getWorker('hello')!.toJSON(), broker.getWorker('foo')!.toJSON() ];
        for (let i = 0; i < workers.length; i++) {
          assert.deepStrictEqual(_.omit(JSON.parse(JSON.stringify(realWorkers[i])), [ 'registerTime' ]), workers[i]);
        }
      });

      it('should sync with no function profile', async () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);

        await profileManager!.set([], 'WAIT');

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'non-exists',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        assert.strictEqual(broker.startingPool.size, 1);
        assert.deepStrictEqual(broker.startingPool.get('foo'), {
          credential: 'bar',
          estimateRequestLeft: 10,
          maxActivateRequests: 10,
        });

        assert.strictEqual(broker.workers.size, 2);
        assert.deepStrictEqual(broker.data, null);
        const workers = [{
          containerStatus: ContainerStatus.Ready,
          turfContainerStates: TurfContainerStates.running,
          name: 'hello',
          credential: 'world',
          pid: 2,
          data: {
            maxActivateRequests: 10,
            activeRequestCount: 7,
          },
        }, {
          containerStatus: ContainerStatus.Created,
          turfContainerStates: TurfContainerStates.running,
          name: 'foo',
          credential: 'bar',
          pid: 1,
          data: null,
        }];
        const realWorkers = [ broker.getWorker('hello')!, broker.getWorker('foo')! ];
        for (let i = 0; i < workers.length; i++) {
          assert.deepStrictEqual(_.omit(realWorkers[i].toJSON(), [ 'registerTime' ]), workers[i]);
        }
      });
    });

    describe('.shrinkDraw()', () => {
      it('should use default strategy LCC', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');
        broker.data = null;

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

        const workers = broker.shrinkDraw(1);

        assert.strictEqual(workers.length, 1);
        assert.strictEqual(workers[0].name, 'foo');
      });

      it('should use default strategy LCC when worker strategy not supported', () => {
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

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
        const broker = new Broker(profileManager!, config, 'func', true);
        broker.register('hello', 'world');
        await sleep(100);
        broker.register('foo', 'bar');

        broker.updateWorkerContainerStatus('hello', ContainerStatus.Ready);
        broker.updateWorkerContainerStatus('foo', ContainerStatus.Ready);

        broker.sync([{
          name: 'hello',
          maxActivateRequests: 10,
          activeRequestCount: 7,
        }, {
          name: 'foo',
          maxActivateRequests: 10,
          activeRequestCount: 8,
        }], [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ], performance.now());

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
