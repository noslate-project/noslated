import assert from 'assert';
import _ from 'lodash';
import FakeTimers, { Clock } from '@sinonjs/fake-timers';
import { Worker } from '#self/control_plane/worker_stats/index';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { FunctionProfileManager as ProfileManager } from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import { ContainerStatus, ContainerStatusReport, ControlPanelEvent } from '#self/lib/constants';
import { performance } from 'perf_hooks';
import sinon from 'sinon';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';

describe(common.testName(__filename), () => {
  const funcData: AworkerFunctionProfile[] = [{
    name: 'func',
    url: `file://${__dirname}`,
    runtime: 'aworker',
    signature: 'xxx',
    sourceFile: 'index.js',
    resourceLimit: {
      memory: 512000000,
    },
  }];

  let profileManager;
  beforeEach(async () => {
    profileManager = new ProfileManager(config);
    await profileManager.set(funcData, 'WAIT');
  });
  afterEach(() => {
    profileManager = null;
  });

  describe('constructor', () => {
    it('should construct', () => {
      const worker = new Worker(config, 'hello', 'world');
      assert.deepStrictEqual(_.omit(worker.toJSON(), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should construct with credential null', () => {
      const worker = new Worker(config, 'hello');
      assert.deepStrictEqual(_.omit(worker.toJSON(), [ 'registerTime' ]), {
        name: 'hello',
        credential: null,
        containerStatus: ContainerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });
  });

  describe('.sync()', () => {
    it('should sync data (null)', () => {
      const worker = new Worker(config, 'hello', 'world');
      worker.sync(null, [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]);
      assert.deepStrictEqual(_.omit(worker.toJSON(), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: 1,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should sync data', () => {
      const worker = new Worker(config, 'hello', 'world');
      worker.sync({ name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 }, [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]);
      assert.deepStrictEqual(_.omit(worker.toJSON(), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: 1,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert.strictEqual(worker.data!.activeRequestCount, 5);
      assert.strictEqual(worker.data!.maxActivateRequests, 10);
      assert(typeof worker.registerTime, 'number');
    });

    it('should sync psData (not hit)', () => {
      const worker = new Worker(config, 'hello', 'world');
      worker.sync(
        { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 },
        [{ name: 'helloo', status: TurfContainerStates.stopped, pid: 1 }]
      );
      assert.deepStrictEqual(_.omit(worker.toJSON(), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should sync psData (hit -> not hit)', () => {
      const worker = new Worker(config, 'hello', 'world');
      worker.sync(
        { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 },
        [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]
      );
      assert.deepStrictEqual(_.omit(JSON.parse(JSON.stringify(worker)), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: 1,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert(typeof worker.registerTime, 'number');

      worker.sync(
        { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 },
        [{ name: 'helloo', status: TurfContainerStates.stopped, pid: 1 }]
      );

      assert.deepStrictEqual(_.omit(JSON.parse(JSON.stringify(worker)), [ 'registerTime', 'firstUnknownTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Stopped,
        turfContainerStates: null,
        pid: null,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should sync psData (not hit -> hit)', () => {
      const worker = new Worker(config, 'hello', 'world');
      worker.sync(
        { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 },
        [{ name: 'helloo', status: TurfContainerStates.stopped, pid: 1 }]
      );
      assert.deepStrictEqual(_.omit(JSON.parse(JSON.stringify(worker)), [ 'registerTime', 'firstUnknownTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert(typeof worker.registerTime, 'number');

      worker.sync(
        { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 },
        [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]
      );
      assert.deepStrictEqual(_.omit(JSON.parse(JSON.stringify(worker)), [ 'registerTime' ]), {
        name: 'hello',
        credential: 'world',
        containerStatus: ContainerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: 1,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert(typeof worker.registerTime, 'number');
    });
  });

  describe('is disappeared', () => {
    const statuses: TurfContainerStates[] = [
      TurfContainerStates.init,
      TurfContainerStates.starting,
      TurfContainerStates.running,
      TurfContainerStates.stopping,
      TurfContainerStates.stopped
    ];

    it('should get', () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(data, []);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      const std = [
        ContainerStatus.Created,
        ContainerStatus.Created,
        // 没有 event 更新为 Ready，所以都是 Created
        ContainerStatus.Created,
        ContainerStatus.Stopped,
        ContainerStatus.Stopped,
      ];

      for (let i = 0; i < statuses.length; i++) {
        worker.sync(data, [{ pid: 1, status: statuses[i], name: 'hello' }]);
        assert.strictEqual(worker.containerStatus, std[i]);
      }

      worker.sync(data, []);
      // 已经 Stopped，状态不会变化，不会回退到旧的值，只能进入 Unknown 状态
      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });

    it('should state to stop when ready sync missing', () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.updateContainerStatus(ContainerStatus.Ready, ContainerStatusReport.ContainerInstalled);

      worker.sync(data, []);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });
  });

  describe('update state', () => {
    it('should update state by event work, shrink', async () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(data, []);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);
      assert.strictEqual(worker.isInitializating(), true);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.running, pid: 1 }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.updateContainerStatusByEvent(ContainerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Ready);
      assert.strictEqual(worker.isRunning(), true);

      worker.updateContainerStatus(ContainerStatus.PendingStop, ControlPanelEvent.Shrink);

      assert.strictEqual(worker.containerStatus, ContainerStatus.PendingStop);

      worker.updateContainerStatusByEvent(ContainerStatusReport.RequestDrained);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });

    it('should update state by event work, gc', async () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(data, []);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.forkwait, pid: 1 }]);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.running, pid: 1 }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.updateContainerStatusByEvent(ContainerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Ready);

      worker.updateContainerStatusByEvent(ContainerStatusReport.ContainerDisconnected);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });

    it('update state has order', async () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(data, []);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.updateContainerStatusByEvent(ContainerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Ready);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      worker.updateContainerStatus(ContainerStatus.Created, ControlPanelEvent.Expand);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      worker.updateContainerStatus(ContainerStatus.PendingStop, ControlPanelEvent.Shrink);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      worker.updateContainerStatusByEvent(ContainerStatusReport.ContainerDisconnected);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.unknown, pid: 1 }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Unknown);

      worker.sync(data, [{ name: 'hello', status: TurfContainerStates.stopped, pid: 1 }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Unknown);
    });

    it('should state unknown when event unsupported', async () => {
      const worker = new Worker(config, 'hello', 'world');
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.updateContainerStatusByEvent('Unsupported' as ContainerStatusReport);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Unknown);
    });
  });

  describe('connect timeout', () => {
    const containerStateses = [ 'init', 'starting', 'running', 'stopping', 'stopped' ];

    let clock: Clock;
    beforeEach(() => {
      clock = FakeTimers.install();
    });
    afterEach(() => {
      clock.uninstall();
    });

    it('with data', () => {
      const data = { name: 'hello', maxActivateRequests: 10, activeRequestCount: 5 };
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(data, [{ pid: 1, status: TurfContainerStates.starting, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.starting);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      clock.tick(config.worker.controlPlaneConnectTimeout + 1000);
      const spy = sinon.spy(worker.logger, 'error');

      worker.sync(data, [{ pid: 1, status: TurfContainerStates.running, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.running);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      assert(spy.calledWithMatch(/connect timeout/));

      spy.restore();
    });

    it('without data', () => {
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(null, [{ pid: 1, status: TurfContainerStates.starting, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.starting);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      clock.tick(config.worker.controlPlaneConnectTimeout + 1000);
      const spy = sinon.spy(worker.logger, 'error');

      worker.sync(null, [{ pid: 1, status: TurfContainerStates.running, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.running);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      assert(spy.calledWithMatch(/connect timeout/));

      spy.restore();
    });

    it('created to stop when unsupported state timeout', () => {
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(null, [{ pid: 1, status: TurfContainerStates.starting, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.starting);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      clock.tick(config.worker.controlPlaneConnectTimeout + 1000);
      const spy = sinon.spy(worker.logger, 'error');

      worker.sync(null, [{ pid: 1, status: 'unsupported' as TurfContainerStates, name: 'hello' }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      assert(spy.calledWithMatch(/connect timeout/));

      spy.restore();
    });

    it('do nothing when unsupported state', () => {
      const worker = new Worker(config, 'hello', 'world');

      worker.sync(null, [{ pid: 1, status: TurfContainerStates.running, name: 'hello' }]);

      assert.strictEqual(worker.turfContainerStates, TurfContainerStates.running);
      assert.strictEqual(worker.containerStatus, ContainerStatus.Created);

      worker.updateContainerStatus(ContainerStatus.Ready, ContainerStatusReport.ContainerInstalled);

      clock.tick(config.worker.controlPlaneConnectTimeout + 1000);

      worker.sync(null, [{ pid: 1, status: 'unsupported' as TurfContainerStates, name: 'hello' }]);

      assert.strictEqual(worker.containerStatus, ContainerStatus.Ready);
    });

  });
});
