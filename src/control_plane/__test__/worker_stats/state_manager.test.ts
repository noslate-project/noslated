import assert from 'assert';
import _ from 'lodash';
import * as common from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import { WorkerStatus, WorkerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import {
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
} from '#self/control_plane/events';
import {
  registerContainers,
  TestContainerManager,
} from '../test_container_manager';
import { TurfContainerStates } from '#self/lib/turf';
import { TestEnvironment } from '../environment';
import { registerWorkers } from '../util';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { EventBus } from '#self/lib/event-bus';
import { Broker } from '#self/control_plane/worker_stats/broker';
import { Worker } from '#self/control_plane/worker_stats/worker';
import { NotNullableInterface } from '#self/lib/interfaces';
import * as root from '#self/proto/root';
import { brokerData, funcData, funcDataWithDefault } from './test_data';
import { ContainerReconciler } from '#self/control_plane/container/reconciler';

describe(common.testName(__filename), () => {
  let eventBus: EventBus;
  let stateManager: StateManager;
  let functionProfile: FunctionProfileManager;
  let testContainerManager: TestContainerManager;
  let containerReconciler: ContainerReconciler;

  const env = new TestEnvironment({
    createTestClock: true,
  });
  let controlPlane: ControlPlane;

  beforeEach(async () => {
    controlPlane = env.control;
    testContainerManager = env.containerManager;
    eventBus = controlPlane._ctx.getInstance('eventBus');
    stateManager = controlPlane._ctx.getInstance('stateManager');
    functionProfile = controlPlane._ctx.getInstance('functionProfile');
    containerReconciler = controlPlane._ctx.getInstance('containerReconciler');
  });

  describe('_updateWorkerStatusByReport()', () => {
    it('should update regularly', async () => {
      await functionProfile.setProfiles([
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
      ]);
      registerWorkers(stateManager, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          toReserve: false,
        },
        {
          funcName: 'func2',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      const worker1 = stateManager.getWorker('func1', false, 'worker1');
      const worker2 = stateManager.getWorker('func2', false, 'worker1');

      assert(worker1);
      assert(worker2);

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.workerStatus, WorkerStatus.Ready);

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.workerStatus, WorkerStatus.PendingStop);

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.workerStatus, WorkerStatus.PendingStop);

      assert.throws(() => {
        stateManager._updateWorkerStatusByReport(
          new WorkerStatusReportEvent({
            functionName: 'func1',
            name: 'worker1',
            isInspector: false,
            event: 'Unknown state',
            requestId: '',
          })
        );
      }, /Unrecognizable WorkerStatusReport/);
      assert.strictEqual(worker1.workerStatus, WorkerStatus.PendingStop);

      const readyFuture = worker2.ready();
      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func2',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker2.workerStatus, WorkerStatus.PendingStop);
      await assert.rejects(readyFuture, /stopped unexpected after start./);
    });

    it('should not update with illegal WorkerStatusReport order', async function () {
      // TODO: create worker with clocks.
      this.timeout(30_000);

      await functionProfile.setProfiles([
        {
          name: 'func1',
          url: `file://${__dirname}`,
          runtime: 'aworker',
          signature: 'xxx',
          sourceFile: 'index.js',
        },
      ]);

      registerWorkers(stateManager, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'cred1',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      const worker = stateManager.getWorker('func1', false, 'worker1');

      assert(worker);

      await assert.rejects(
        async () => {
          await worker.ready();
        },
        {
          message: /initialization timeout./,
        }
      );

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);

      stateManager._updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: WorkerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker.workerStatus, WorkerStatus.PendingStop);
    });
  });

  describe('_syncWorkerData()', () => {
    it('should sync', async () => {
      await functionProfile.setProfiles([
        {
          name: 'func1',
          url: `file://${__dirname}`,
          runtime: 'aworker',
          signature: 'xxx',
          sourceFile: 'index.js',
        },
      ]);

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

      registerWorkers(stateManager, [
        {
          funcName: 'func1',
          processName: 'worker1',
          credential: 'id1',
          options: { inspect: false },
          toReserve: false,
        },
        {
          funcName: 'func1',
          processName: 'worker2',
          credential: 'id2',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      registerContainers(env.containerManager, stateManager, [
        { name: 'worker1', status: TurfContainerStates.running, pid: 123 },
        { name: 'worker2', status: TurfContainerStates.running, pid: 124 },
      ]);
      await containerReconciler.reconcile();
      await stateManager._syncBrokerData([brokerStat1]);

      assert.strictEqual(stateManager['_brokers'].size, 1);
      assert.strictEqual(
        stateManager.getBroker('func1', false)!.workers.size,
        2
      );

      assert.deepStrictEqual(
        _.omit(
          stateManager
            .getBroker('func1', false)!
            .getWorker('worker1')!
            .toJSON(),
          'registerTime'
        ),
        {
          name: 'worker1',
          pid: 123,
          credential: 'id1',
          turfContainerStates: TurfContainerStates.running,
          containerStatus: WorkerStatus.Created,
          data: { maxActivateRequests: 10, activeRequestCount: 1 },
        }
      );

      const worker2 = stateManager
        .getBroker('func1', false)!
        .getWorker('worker2');
      assert(worker2);
      assert.deepStrictEqual(_.omit(worker2.toJSON(), 'registerTime'), {
        name: 'worker2',
        pid: 124,
        credential: 'id2',
        turfContainerStates: TurfContainerStates.running,
        containerStatus: WorkerStatus.Created,
        data: { maxActivateRequests: 10, activeRequestCount: 6 },
      });

      // Suppress worker ready rejection
      worker2.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

      const workerStoppedFuture = eventBus.once(WorkerStoppedEvent);
      await env.containerManager.getContainer('worker2')!.stop();

      const event = await workerStoppedFuture;
      assert.strictEqual(event.data.workerName, 'worker2');

      await stateManager._syncBrokerData([brokerStat1]);

      assert.strictEqual(stateManager['_brokers'].size, 1);
      assert.strictEqual(
        stateManager.getBroker('func1', false)!.workers.size,
        1
      );
      assert.deepStrictEqual(
        stateManager.getBroker('func1', false)!.getWorker('worker2'),
        null
      );
    });
  });

  describe('.register()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should register', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      assert.strictEqual(stateManager._brokers.size, 2);
      const brokerKeys = [...stateManager._brokers.keys()].sort();
      const brokers = [...stateManager._brokers.values()].sort((a, b) => {
        return a.name === b.name
          ? a.isInspector
            ? -1
            : 1
          : a.name < b.name
          ? -1
          : 1;
      });
      assert.deepStrictEqual(brokerKeys, [
        'func:inspector',
        'func:noinspector',
      ]);
      brokers.forEach(b => assert(b instanceof Broker));

      const names = ['func', 'func'];
      const inspectors = [true, false];
      const profiles = [funcDataWithDefault, funcDataWithDefault];
      assert.deepStrictEqual(
        brokers.map(b => b.name),
        names
      );
      assert.deepStrictEqual(
        brokers.map(b => b.isInspector),
        inspectors
      );
      assert.deepStrictEqual(
        brokers.map(b => b.profile),
        profiles
      );
      const startingPoolsName = ['hello', 'foooo'];
      brokers.forEach((broker, i) => {
        assert.strictEqual(broker['startingPool'].size, 1);
        const sp = broker['startingPool'].get(startingPoolsName[i]);
        assert.deepStrictEqual(sp, {
          credential: i === 0 ? 'world' : 'bar',
          maxActivateRequests: 10,
          estimateRequestLeft: 10,
        });
      });
      const workerNames = ['hello', 'foooo'];
      const workers: Worker[] = brokers.map(
        (b, i) => b.workers.get(workerNames[i])!
      );
      workers.forEach(w => assert(w instanceof Worker));
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(workers.map(worker => worker.toJSON()))),
        [
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'hello',
            credential: 'world',
            registerTime: workers[0].registerTime,
            pid: null,
            data: null,
          },
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'foooo',
            credential: 'bar',
            registerTime: workers[1].registerTime,
            pid: null,
            data: null,
          },
        ]
      );
    });

    it('should throw on unrecognizable function', () => {
      assert.throws(
        () => {
          registerWorkers(stateManager, [
            {
              funcName: 'non-exists',
              processName: 'aha',
              credential: 'oho',
              options: { inspect: true },
              toReserve: false,
            },
          ]);
        },
        {
          message: /No function named non-exists in function profile\./,
        }
      );
    });
  });

  describe('.getBroker()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should get broker', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      const brokers = [
        stateManager.getBroker('func', true)!,
        stateManager.getBroker('func', false)!,
      ];
      brokers.forEach(b => assert(b instanceof Broker));

      const names = ['func', 'func'];
      const inspectors = [true, false];
      const profiles = [funcDataWithDefault, funcDataWithDefault];
      assert.deepStrictEqual(
        brokers.map(b => b.name),
        names
      );
      assert.deepStrictEqual(
        brokers.map(b => b.isInspector),
        inspectors
      );
      assert.deepStrictEqual(
        brokers.map(b => b.profile),
        profiles
      );
      const startingPoolsName = ['hello', 'foooo'];
      brokers.forEach((broker, i) => {
        assert.strictEqual(broker['startingPool'].size, 1);
        const sp = broker['startingPool'].get(startingPoolsName[i]);
        assert.deepStrictEqual(sp, {
          credential: i === 0 ? 'world' : 'bar',
          maxActivateRequests: 10,
          estimateRequestLeft: 10,
        });
      });
      const workerNames = ['hello', 'foooo'];
      const workers: Worker[] = brokers.map(
        (b, i) => b.workers.get(workerNames[i])!
      );
      workers.forEach(w => assert(w instanceof Worker));
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(workers.map(worker => worker.toJSON()))),
        [
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'hello',
            credential: 'world',
            registerTime: workers[0].registerTime,
            pid: null,
            data: null,
          },
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'foooo',
            credential: 'bar',
            registerTime: workers[1].registerTime,
            pid: null,
            data: null,
          },
        ]
      );
    });

    it('should not get broker', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);
      assert.strictEqual(stateManager.getBroker('non-exists', true), null);
    });
  });

  describe('.getWorker()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should get worker', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      const workers: Worker[] = [
        stateManager.getWorker('func', true, 'hello')!,
        stateManager.getWorker('func', false, 'foooo')!,
      ];
      workers.forEach(w => assert(w instanceof Worker));
      assert.deepStrictEqual(
        JSON.parse(JSON.stringify(workers.map(worker => worker.toJSON()))),
        [
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'hello',
            credential: 'world',
            registerTime: workers[0].registerTime,
            pid: null,
            data: null,
          },
          {
            containerStatus: WorkerStatus.Created,
            turfContainerStates: null,
            name: 'foooo',
            credential: 'bar',
            registerTime: workers[1].registerTime,
            pid: null,
            data: null,
          },
        ]
      );
    });

    it('should not get worker', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      assert.strictEqual(stateManager.getWorker('func', false, 'hello'), null);
      assert.strictEqual(stateManager.getWorker('func', true, 'bar'), null);
    });

    it('should not get worker when broker is non-exist', () => {
      assert.strictEqual(
        stateManager.getWorker('non-exist', false, 'hello'),
        null
      );
    });
  });

  describe('.getSnapshot()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should to protobuf object', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      assert.deepStrictEqual(stateManager.getSnapshot(), [
        {
          name: 'func',
          inspector: true,
          profile: funcDataWithDefault,
          redundantTimes: 0,
          startingPool: [
            {
              credential: 'world',
              estimateRequestLeft: 10,
              maxActivateRequests: 10,
              workerName: 'hello',
            },
          ],
          workers: [
            {
              containerStatus: WorkerStatus.Created,
              turfContainerStates: null,
              name: 'hello',
              credential: 'world',
              data: null,
              pid: null,
              registerTime: stateManager.getWorker('func', true, 'hello')!
                .registerTime,
            },
          ],
        },
        {
          name: 'func',
          inspector: false,
          profile: funcDataWithDefault,
          redundantTimes: 0,
          startingPool: [
            {
              credential: 'bar',
              estimateRequestLeft: 10,
              maxActivateRequests: 10,
              workerName: 'foooo',
            },
          ],
          workers: [
            {
              containerStatus: WorkerStatus.Created,
              turfContainerStates: null,
              name: 'foooo',
              credential: 'bar',
              data: null,
              pid: null,
              registerTime: stateManager.getWorker('func', false, 'foooo')!
                .registerTime,
            },
          ],
        },
      ]);
    });

    it('should to protobuf object with worker data', () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
      ]);
      stateManager._syncBrokerData(brokerData);

      assert.deepStrictEqual(stateManager.getSnapshot(), [
        {
          name: 'func',
          inspector: true,
          profile: funcDataWithDefault,
          redundantTimes: 0,
          startingPool: [
            {
              credential: 'world',
              estimateRequestLeft: 9,
              maxActivateRequests: 10,
              workerName: 'hello',
            },
          ],
          workers: [
            {
              containerStatus: WorkerStatus.Created,
              turfContainerStates: null,
              name: 'hello',
              credential: 'world',
              data: {
                maxActivateRequests: 10,
                activeRequestCount: 1,
              },
              pid: null,
              registerTime: stateManager.getWorker('func', true, 'hello')!
                .registerTime,
            },
          ],
        },
      ]);
    });
  });

  describe('.sync()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should sync', async () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);

      registerContainers(testContainerManager, stateManager, [
        { pid: 1, name: 'foooo', status: TurfContainerStates.running },
      ]);
      await testContainerManager.reconcileContainers();

      stateManager._syncBrokerData([
        ...brokerData,
        {
          functionName: 'hoho',
          inspector: false,
          workers: [
            {
              name: 'aho',
              credential: 'aha',
              maxActivateRequests: 10,
              activeRequestCount: 6,
            },
          ],
        },
      ]);

      // hoho should be ignored
      assert.strictEqual(stateManager._brokers.size, 2);

      const brokers = [
        stateManager.getBroker('func', true)!,
        stateManager.getBroker('func', false)!,
      ];

      const inspectors = [true, false];
      const workerNames = ['hello', 'foooo'];
      const workerCredentials = ['world', 'bar'];
      const turfContainerStateses = [null, TurfContainerStates.running];
      const containerStatus: WorkerStatus[] = [
        WorkerStatus.Created,
        WorkerStatus.Created,
      ];
      const pids = [null, 1];

      brokers.forEach((broker, i) => {
        assert.strictEqual(broker.name, 'func');
        assert.strictEqual(broker.isInspector, inspectors[i]);
        assert.deepStrictEqual(
          broker.profile,
          functionProfile.getProfile('func')
        );
        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker['startingPool'].size, 1);

        const worker: Partial<Worker> = JSON.parse(
          JSON.stringify(broker.workers.get(workerNames[i]))
        );
        assert.deepStrictEqual(worker, {
          containerStatus: containerStatus[i],
          turfContainerStates: turfContainerStateses[i],
          name: workerNames[i],
          credential: workerCredentials[i],
          pid: pids[i],
          data: _.pick(JSON.parse(JSON.stringify(brokerData[i].workers[0])), [
            'activeRequestCount',
            'maxActivateRequests',
          ]),
          registerTime: worker.registerTime,
        });
      });

      // 事件更新，container ready
      updateWorkerContainerStatus(stateManager, {
        functionName: 'func',
        name: 'hello',
        isInspector: true,
        event: WorkerStatusReport.ContainerInstalled,
        requestId: '',
      });

      registerContainers(testContainerManager, stateManager, [
        /** foooo has been disappeared */
        { pid: 2, name: 'hello', status: TurfContainerStates.running },
      ]);
      const readyFuture = stateManager
        .getWorker('func', false, 'foooo')!
        .ready();
      await testContainerManager.reconcileContainers();
      stateManager._syncBrokerData(brokerData);

      const _turfContainerStateses = [
        TurfContainerStates.running,
        TurfContainerStates.unknown,
      ];
      const _containerStatus: WorkerStatus[] = [
        WorkerStatus.Ready,
        WorkerStatus.Unknown,
      ];
      const _pids = [2, 1];
      const _startingPoolSize = [0, 1];

      brokers.forEach((broker, i) => {
        assert.strictEqual(broker.name, 'func');
        assert.strictEqual(broker.isInspector, inspectors[i]);
        assert.deepStrictEqual(
          broker.profile,
          functionProfile.getProfile('func')
        );
        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker['startingPool'].size, _startingPoolSize[i]);

        const worker: Partial<Worker> = JSON.parse(
          JSON.stringify(broker.workers.get(workerNames[i]))
        );
        assert.deepStrictEqual(worker, {
          containerStatus: _containerStatus[i],
          turfContainerStates: _turfContainerStateses[i],
          name: workerNames[i],
          credential: workerCredentials[i],
          pid: _pids[i],
          data: _.pick(JSON.parse(JSON.stringify(brokerData[i].workers[0])), [
            'activeRequestCount',
            'maxActivateRequests',
          ]),
          registerTime: worker.registerTime,
        });
      });

      await assert.rejects(readyFuture, /stopped unexpected after start/);
    });
  });

  describe('.correct()', () => {
    beforeEach(async () => {
      await functionProfile.setProfiles(funcData);
    });

    it('should correct gc stopped and unknown container', async () => {
      registerWorkers(stateManager, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          toReserve: false,
        },
      ]);
      registerContainers(testContainerManager, stateManager, [
        { name: 'hello', pid: 1, status: TurfContainerStates.running },
        { name: 'foooo', pid: 1, status: TurfContainerStates.running },
      ]);

      updateWorkerContainerStatus(stateManager, {
        functionName: 'func',
        isInspector: true,
        event: WorkerStatusReport.ContainerInstalled,
        name: 'hello',
        requestId: '',
      });
      // Suppress ready rejection
      updateWorkerContainerStatus(stateManager, {
        functionName: 'func',
        isInspector: false,
        event: WorkerStatusReport.ContainerInstalled,
        name: 'foooo',
        requestId: '',
      });

      updateWorkerContainerStatus(stateManager, {
        functionName: 'func',
        isInspector: false,
        event: WorkerStatusReport.ContainerDisconnected,
        name: 'foooo',
        requestId: '',
      });

      assert.strictEqual(stateManager.getBroker('func', true)!.workers.size, 1);
      assert.strictEqual(
        stateManager.getBroker('func', false)!.workers.size,
        1
      );

      let workerStoppedFuture = eventBus.once(WorkerStoppedEvent);
      // 回收 PendingStop
      await stateManager._correct();

      assert.strictEqual(stateManager.getBroker('func', true)!.workers.size, 1);
      assert.strictEqual(
        stateManager.getBroker('func', false)!.workers.size,
        1
      );

      {
        const event = await workerStoppedFuture;
        assert.strictEqual(event.data.workerName, 'foooo');
        assert(testContainerManager.getContainer('foooo') == null);
      }

      registerContainers(testContainerManager, stateManager, [
        { pid: 2, name: 'hello', status: TurfContainerStates.unknown },
      ]);
      await testContainerManager.reconcileContainers();
      stateManager._syncBrokerData(brokerData);

      workerStoppedFuture = eventBus.once(WorkerStoppedEvent);
      // 回收 Unknown
      await stateManager._correct();

      assert.strictEqual(stateManager.getBroker('func', true)!.workers.size, 0);
      assert.strictEqual(
        stateManager.getBroker('func', false)!.workers.size,
        0
      );

      assert(testContainerManager.getContainer('hello') == null);

      {
        const event = await workerStoppedFuture;
        assert.strictEqual(event.data.workerName, 'hello');
      }

      stateManager._syncBrokerData([]);

      // 配置更新后，回收无用 broker
      await stateManager._correct();

      assert.strictEqual(stateManager.getBroker('func', true), null);
      assert.strictEqual(stateManager.getBroker('func', false), null);
    });
  });
});

function updateWorkerContainerStatus(
  stateManager: StateManager,
  report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
) {
  const { functionName, isInspector, name, event } = report;

  const worker = stateManager.getWorker(functionName, isInspector, name);

  if (worker) {
    worker.updateWorkerStatusByReport(event as WorkerStatusReport);

    // 如果已经 ready，则从 starting pool 中移除
    if (worker.workerStatus === WorkerStatus.Ready) {
      const broker = stateManager.getBroker(functionName, isInspector);
      broker?.removeItemFromStartingPool(worker.name);
    }
  }
}
