import assert from 'assert';
import { performance } from 'perf_hooks';

import _ from 'lodash';

import FakeTimers, { Clock } from '@sinonjs/fake-timers';
import {
  Worker,
  WorkerMetadata,
} from '#self/control_plane/worker_stats/worker';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { FunctionProfileManager as ProfileManager } from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import {
  WorkerStatus,
  WorkerStatusReport,
  ControlPlaneEvent,
} from '#self/lib/constants';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import { NoslatedClient } from '#self/sdk';
import { DefaultEnvironment } from '#self/test/env/environment';
import { SimpleContainer } from '../test_container_manager';
import { registerWorkers } from '../util';

describe(common.testName(__filename), () => {
  const funcData: AworkerFunctionProfile[] = [
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
  ];

  const env = new DefaultEnvironment();

  let profileManager: ProfileManager | null;
  let agent: NoslatedClient;
  let stateManager: StateManager;

  beforeEach(async () => {
    agent = env.agent;
    stateManager = env.control._ctx.getInstance('stateManager');
    profileManager = env.control._ctx.getInstance('functionProfile');
    await profileManager.set(funcData, 'WAIT');
  });
  afterEach(async () => {
    profileManager = null;
  });

  describe('constructor', () => {
    it('should construct', () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      assert.deepStrictEqual(_.omit(worker.toJSON(), ['registerTime']), {
        name: 'hello',
        credential: 'world',
        containerStatus: WorkerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should construct with credential null', () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello'
      );
      const worker = new Worker(workerMetadata, config);
      assert.deepStrictEqual(_.omit(worker.toJSON(), ['registerTime']), {
        name: 'hello',
        credential: null,
        containerStatus: WorkerStatus.Created,
        turfContainerStates: null,
        pid: null,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });
  });

  describe('.sync()', () => {
    it('should sync data', () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      // Suppress ready rejection.
      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      container.updateStatus(TurfContainerStates.stopped);
      worker.sync({
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 5,
      });
      assert.deepStrictEqual(_.omit(worker.toJSON(), ['registerTime']), {
        name: 'hello',
        credential: 'world',
        containerStatus: WorkerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: container.pid,
        data: {
          maxActivateRequests: 10,
          activeRequestCount: 5,
        },
      });
      assert.strictEqual(worker.data!.activeRequestCount, 5);
      assert.strictEqual(worker.data!.maxActivateRequests, 10);
      assert(typeof worker.registerTime, 'number');
    });
  });

  describe('.setContainer()', () => {
    it('should sync container status', () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      // Suppress ready rejection.
      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      container.updateStatus(TurfContainerStates.stopped);

      assert.deepStrictEqual(_.omit(worker.toJSON(), ['registerTime']), {
        name: 'hello',
        credential: 'world',
        containerStatus: WorkerStatus.Stopped,
        turfContainerStates: TurfContainerStates.stopped,
        pid: container.pid,
        data: null,
      });
      assert(typeof worker.registerTime, 'number');
    });

    it('should sync container status (hit -> not hit)', () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      // Suppress ready rejection.
      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      container.updateStatus(TurfContainerStates.stopped);

      assert.deepStrictEqual(
        _.omit(JSON.parse(JSON.stringify(worker)), ['registerTime']),
        {
          name: 'hello',
          credential: 'world',
          containerStatus: WorkerStatus.Stopped,
          turfContainerStates: TurfContainerStates.stopped,
          pid: container.pid,
          data: null,
        }
      );
      assert(typeof worker.registerTime, 'number');

      container.updateStatus(TurfContainerStates.unknown);

      assert.deepStrictEqual(
        _.omit(JSON.parse(JSON.stringify(worker)), [
          'registerTime',
          'firstUnknownTime',
        ]),
        {
          name: 'hello',
          credential: 'world',
          containerStatus: WorkerStatus.Unknown,
          turfContainerStates: TurfContainerStates.unknown,
          pid: 1,
          data: null,
        }
      );
      assert(typeof worker.registerTime, 'number');
    });
  });

  describe('is disappeared', () => {
    const statuses: TurfContainerStates[] = [
      TurfContainerStates.init,
      TurfContainerStates.starting,
      TurfContainerStates.running,
      TurfContainerStates.stopping,
      TurfContainerStates.stopped,
    ];

    it('should get', async () => {
      const data = {
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 5,
      };
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      const container = new SimpleContainer('hello');

      worker.sync(data);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);
      worker.setContainer(container);
      const readyFuture = assert.rejects(
        worker.ready(),
        /stopped unexpected after start./
      );

      const std = [
        WorkerStatus.Created,
        WorkerStatus.Created,
        // 没有 event 更新为 Ready，所以都是 Created
        WorkerStatus.Created,
        WorkerStatus.Stopped,
        WorkerStatus.Stopped,
      ];

      for (let i = 0; i < statuses.length; i++) {
        container.updateStatus(statuses[i]);
        assert.strictEqual(worker.workerStatus, std[i]);
      }

      worker.sync(data);
      await readyFuture;
      // 已经 Stopped，状态不会变化，不会回退到旧的值，只能进入 Unknown 状态
      assert.strictEqual(worker.workerStatus, WorkerStatus.Stopped);
    });
  });

  describe('update state', () => {
    it('should update state by event work, shrink', async () => {
      const data = {
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 5,
      };
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      worker.sync(data);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);
      assert.strictEqual(worker.isInitializing(), true);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.running);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Ready);
      assert.strictEqual(worker.isActive(), true);

      worker.updateWorkerStatusByControlPlaneEvent(ControlPlaneEvent.Shrink);

      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);

      worker.updateWorkerStatusByReport(WorkerStatusReport.RequestDrained);

      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);
    });

    it('should update state by event work, gc', async () => {
      const data = {
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 5,
      };
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      worker.sync(data);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.forkwait);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      container.updateStatus(TurfContainerStates.running);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Ready);

      worker.updateWorkerStatusByReport(
        WorkerStatusReport.ContainerDisconnected
      );

      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);
    });

    it('update state has order', async () => {
      const data = {
        name: 'hello',
        maxActivateRequests: 10,
        activeRequestCount: 5,
      };
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      worker.sync(data);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Ready);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.stopped);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Stopped);

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Stopped);

      worker.updateWorkerStatusByControlPlaneEvent(ControlPlaneEvent.Shrink);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Stopped);

      worker.updateWorkerStatusByReport(
        WorkerStatusReport.ContainerDisconnected
      );

      assert.strictEqual(worker.workerStatus, WorkerStatus.Stopped);

      container.updateStatus(TurfContainerStates.unknown);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Unknown);

      container.updateStatus(TurfContainerStates.stopped);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Unknown);
    });

    it('should state unknown when event unsupported', async () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      worker.updateWorkerStatusByReport('Unsupported' as WorkerStatusReport);
      assert.strictEqual(worker.workerStatus, WorkerStatus.Unknown);
    });
  });

  describe('connect timeout', () => {
    let clock: Clock;

    beforeEach(() => {
      clock = FakeTimers.install();
    });
    afterEach(() => {
      clock.uninstall();
    });

    it('without data', async () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.starting);

      assert.strictEqual(
        worker.turfContainerStates,
        TurfContainerStates.starting
      );
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      const readyFuture = assert.rejects(
        worker.ready(),
        /initialization timeout/
      );

      clock.tick(config.worker.defaultInitializerTimeout + 1000);
      container.updateStatus(TurfContainerStates.running);

      assert.strictEqual(
        worker.turfContainerStates,
        TurfContainerStates.running
      );
      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);

      await readyFuture;
    });

    it('created to stop when unsupported state timeout', async () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.starting);

      assert.strictEqual(
        worker.turfContainerStates,
        TurfContainerStates.starting
      );
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);

      const readyFuture = assert.rejects(
        worker.ready(),
        /initialization timeout/
      );

      clock.tick(config.worker.defaultInitializerTimeout + 1000);

      container.updateStatus('unsupported' as TurfContainerStates);
      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);

      await readyFuture;
    });

    it('do nothing when unsupported state', async () => {
      const workerMetadata = new WorkerMetadata(
        'func',
        { inspect: false },
        false,
        false,
        'hello',
        'world'
      );
      const worker = new Worker(workerMetadata, config);

      const container = new SimpleContainer('hello');
      worker.setContainer(container);
      container.updateStatus(TurfContainerStates.running);

      assert.strictEqual(
        worker.turfContainerStates,
        TurfContainerStates.running
      );
      assert.strictEqual(worker.workerStatus, WorkerStatus.Created);
      const readyFuture = worker.ready();

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      clock.tick(config.worker.defaultInitializerTimeout + 1000);

      container.updateStatus('unsupported' as TurfContainerStates);

      assert.strictEqual(worker.workerStatus, WorkerStatus.Ready);
      await readyFuture;
    });
  });

  describe('worker ready', () => {
    let worker: Worker;
    beforeEach(async () => {
      await agent.setFunctionProfile(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
            worker: {
              initializationTimeout: 1000,
            },
          },
        ],
        'WAIT'
      );
      registerWorkers(stateManager, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);
      worker = stateManager.getWorker('func1', false, 'worker1')!;
    });

    it('should worker ready after initializer handler success', async () => {
      const now = performance.now();

      setTimeout(() => {
        worker.updateWorkerStatusByReport(
          WorkerStatusReport.ContainerInstalled
        );
      }, 500 + 10);

      await worker.ready();

      assert.ok(performance.now() - now >= 500);
    });

    it('should throw error when ready timeout', async () => {
      await assert.rejects(
        async () => {
          await worker.ready();
        },
        {
          message: /initialization timeout/,
        }
      );
    });

    it('should throw error when set stopped before ready', async () => {
      const readyFuture = worker.ready();
      worker.updateWorkerStatusByReport(
        WorkerStatusReport.ContainerDisconnected
      );

      await assert.rejects(readyFuture, {
        message: /stopped unexpected after start/,
      });
    });

    it('should do nothing when emit stopped after ready', async () => {
      const readyFuture = worker.ready();

      worker.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);
      worker.updateWorkerStatusByReport(
        WorkerStatusReport.ContainerDisconnected
      );

      await readyFuture;
    });

    it('should do nothing when setReady before wait ready', async () => {
      worker['_setReady']();

      await worker.ready();
    });

    it('should do nothing when setStopped before wait ready', async () => {
      worker['_setStopped']();

      await assert.rejects(
        async () => {
          await worker.ready();
        },
        {
          message: /stopped unexpected after start./,
        }
      );
    });
  });
});
