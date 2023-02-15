import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import {
  Broker,
  Worker,
  WorkerStatsSnapshot,
} from '#self/control_plane/worker_stats/index';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { FunctionProfileManager as ProfileManager } from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import sinon from 'sinon';
import fs from 'fs';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { NotNullableInterface } from '#self/lib/interfaces';
import * as root from '#self/proto/root';
import {
  registerContainers,
  TestContainerManager,
} from '../test_container_manager';

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

  const brokerData = [
    {
      functionName: 'func',
      inspector: true,
      workers: [
        {
          name: 'hello',
          credential: 'world',
          maxActivateRequests: 10,
          activeRequestCount: 1,
        },
      ],
    },
    {
      functionName: 'func',
      inspector: false,
      workers: [
        {
          // turf min sandbox name is 5
          name: 'foooo',
          credential: 'bar',
          maxActivateRequests: 10,
          activeRequestCount: 6,
        },
      ],
    },
  ];

  let profileManager: ProfileManager;
  beforeEach(async () => {
    profileManager = new ProfileManager(config);
    await profileManager.set(funcData, 'WAIT');
  });
  afterEach(async () => {
    mm.restore();
  });

  describe('WorkerStatsSnapshot', () => {
    let testContainerManager: TestContainerManager;
    let workerStatsSnapshot: WorkerStatsSnapshot;
    let clock: common.TestClock;

    beforeEach(async () => {
      clock = common.createTestClock({
        shouldAdvanceTime: true,
      });
      testContainerManager = new TestContainerManager(clock);
      workerStatsSnapshot = new WorkerStatsSnapshot(
        profileManager,
        config,
        clock
      );
      await workerStatsSnapshot.ready();
    });
    afterEach(async () => {
      await workerStatsSnapshot.close();
      clock.uninstall();
    });

    describe('.register()', () => {
      it('should register', () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        assert.strictEqual(workerStatsSnapshot.brokers.size, 2);
        const brokerKeys = [...workerStatsSnapshot.brokers.keys()].sort();
        const brokers = [...workerStatsSnapshot.brokers.values()].sort(
          (a, b) => {
            return a.name === b.name
              ? a.isInspector
                ? -1
                : 1
              : a.name < b.name
              ? -1
              : 1;
          }
        );
        assert.deepStrictEqual(brokerKeys, [
          'func:inspector',
          'func:noinspector',
        ]);
        brokers.forEach(b => assert(b instanceof Broker));

        const names = ['func', 'func'];
        const inspectors = [true, false];
        const datas = [funcDataWithDefault, funcDataWithDefault];
        assert.deepStrictEqual(
          brokers.map(b => b.name),
          names
        );
        assert.deepStrictEqual(
          brokers.map(b => b.isInspector),
          inspectors
        );
        assert.deepStrictEqual(
          brokers.map(b => b.data),
          datas
        );
        const startingPoolsName = ['hello', 'foooo'];
        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.startingPool.size, 1);
          const sp = broker.startingPool.get(startingPoolsName[i]);
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
              containerStatus: ContainerStatus.Created,
              turfContainerStates: null,
              name: 'hello',
              credential: 'world',
              registerTime: workers[0].registerTime,
              pid: null,
              data: null,
            },
            {
              containerStatus: ContainerStatus.Created,
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

      it('should throw', () => {
        assert.throws(
          () => {
            workerStatsSnapshot.register({
              funcName: 'non-exists',
              processName: 'aha',
              credential: 'oho',
              options: { inspect: true },
              disposable: false,
              toReserve: false,
            });
          },
          {
            message: /No function named non-exists in function profile\./,
          }
        );
      });
    });

    describe('.unregister()', () => {
      it('should unregister only one worker', async () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });
        registerContainers(testContainerManager, workerStatsSnapshot, [
          { name: 'hello', pid: 1, status: TurfContainerStates.running },
          { name: 'foooo', pid: 2, status: TurfContainerStates.running },
        ]);

        await workerStatsSnapshot.unregister('func', 'foooo', false);
        await workerStatsSnapshot.unregister('non-exists', 'aha', true);

        assert.strictEqual(workerStatsSnapshot.brokers.size, 1);
        const broker = workerStatsSnapshot.brokers.get(
          Broker.getKey('func', true)
        );
        assert(broker instanceof Broker);

        assert.strictEqual(broker.name, 'func');
        assert.strictEqual(broker.isInspector, true);
        assert.deepStrictEqual(broker.data, funcDataWithDefault);
        assert.strictEqual(broker.startingPool.size, 1);
        assert.deepStrictEqual(broker.startingPool.get('hello'), {
          credential: 'world',
          maxActivateRequests: 10,
          estimateRequestLeft: 10,
        });
        assert.strictEqual(broker.workers.size, 1);
        const worker = broker.workers.get('hello');
        assert(worker instanceof Worker);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(worker.toJSON())), {
          containerStatus: ContainerStatus.Created,
          turfContainerStates: TurfContainerStates.init,
          name: 'hello',
          credential: 'world',
          registerTime: worker.registerTime,
          pid: 1,
          data: null,
        });

        assert.strictEqual(testContainerManager.list().length, 1);
        assert.ok(testContainerManager.getContainer('foooo') == null);
      });

      it('should remove broker when workers empty after unregister', async () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });
        await workerStatsSnapshot.unregister('func', 'hello', true);

        assert.strictEqual(workerStatsSnapshot.brokers.size, 0);
      });
    });

    describe('.getBroker()', () => {
      it('should get broker', () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        const brokers = [
          workerStatsSnapshot.getBroker('func', true)!,
          workerStatsSnapshot.getBroker('func', false)!,
        ];
        brokers.forEach(b => assert(b instanceof Broker));

        const names = ['func', 'func'];
        const inspectors = [true, false];
        const datas = [funcDataWithDefault, funcDataWithDefault];
        assert.deepStrictEqual(
          brokers.map(b => b.name),
          names
        );
        assert.deepStrictEqual(
          brokers.map(b => b.isInspector),
          inspectors
        );
        assert.deepStrictEqual(
          brokers.map(b => b.data),
          datas
        );
        const startingPoolsName = ['hello', 'foooo'];
        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.startingPool.size, 1);
          const sp = broker.startingPool.get(startingPoolsName[i]);
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
              containerStatus: ContainerStatus.Created,
              turfContainerStates: null,
              name: 'hello',
              credential: 'world',
              registerTime: workers[0].registerTime,
              pid: null,
              data: null,
            },
            {
              containerStatus: ContainerStatus.Created,
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
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });
        assert.strictEqual(
          workerStatsSnapshot.getBroker('non-exists', true),
          null
        );
      });
    });

    describe('.getWorker()', () => {
      it('should get worker', () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        const workers: Worker[] = [
          workerStatsSnapshot.getWorker('func', true, 'hello')!,
          workerStatsSnapshot.getWorker('func', false, 'foooo')!,
        ];
        workers.forEach(w => assert(w instanceof Worker));
        assert.deepStrictEqual(
          JSON.parse(JSON.stringify(workers.map(worker => worker.toJSON()))),
          [
            {
              containerStatus: ContainerStatus.Created,
              turfContainerStates: null,
              name: 'hello',
              credential: 'world',
              registerTime: workers[0].registerTime,
              pid: null,
              data: null,
            },
            {
              containerStatus: ContainerStatus.Created,
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
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        assert.strictEqual(
          workerStatsSnapshot.getWorker('func', false, 'hello'),
          null
        );
        assert.strictEqual(
          workerStatsSnapshot.getWorker('func', true, 'bar'),
          null
        );
      });

      it('should not get worker when broker is non-exist', () => {
        assert.strictEqual(
          workerStatsSnapshot.getWorker('non-exist', false, 'hello'),
          null
        );
      });
    });

    describe('.toProtobufObject()', () => {
      it('should to protobuf object', () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        assert.deepStrictEqual(workerStatsSnapshot.toProtobufObject(), [
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
                containerStatus: ContainerStatus.Created,
                turfContainerStates: null,
                name: 'hello',
                credential: 'world',
                data: null,
                pid: null,
                registerTime: workerStatsSnapshot.getWorker(
                  'func',
                  true,
                  'hello'
                )!.registerTime,
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
                containerStatus: ContainerStatus.Created,
                turfContainerStates: null,
                name: 'foooo',
                credential: 'bar',
                data: null,
                pid: null,
                registerTime: workerStatsSnapshot.getWorker(
                  'func',
                  false,
                  'foooo'
                )!.registerTime,
              },
            ],
          },
        ]);
      });

      it('should to protobuf object with worker data', () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.sync(brokerData);

        assert.deepStrictEqual(workerStatsSnapshot.toProtobufObject(), [
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
                containerStatus: ContainerStatus.Created,
                turfContainerStates: null,
                name: 'hello',
                credential: 'world',
                data: {
                  maxActivateRequests: 10,
                  activeRequestCount: 1,
                },
                pid: null,
                registerTime: workerStatsSnapshot.getWorker(
                  'func',
                  true,
                  'hello'
                )!.registerTime,
              },
            ],
          },
        ]);
      });
    });

    describe('.sync()', () => {
      it('should sync', async () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        registerContainers(testContainerManager, workerStatsSnapshot, [
          { pid: 1, name: 'foooo', status: TurfContainerStates.running },
        ]);
        await testContainerManager.reconcileContainers();

        workerStatsSnapshot.sync([
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
        assert.strictEqual(workerStatsSnapshot.brokers.size, 2);

        const brokers = [
          workerStatsSnapshot.getBroker('func', true)!,
          workerStatsSnapshot.getBroker('func', false)!,
        ];

        const inspectors = [true, false];
        const workerNames = ['hello', 'foooo'];
        const workerCredentials = ['world', 'bar'];
        const turfContainerStateses = [null, TurfContainerStates.running];
        const containerStatus: ContainerStatus[] = [
          ContainerStatus.Created,
          ContainerStatus.Created,
        ];
        const pids = [null, 1];

        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.name, 'func');
          assert.strictEqual(broker.isInspector, inspectors[i]);
          assert.deepStrictEqual(
            broker.data,
            broker.profiles.get('func')!.toJSON(true)
          );
          assert.strictEqual(broker.workers.size, 1);
          assert.strictEqual(broker.startingPool.size, 1);

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
        updateWorkerContainerStatus(workerStatsSnapshot, {
          functionName: 'func',
          name: 'hello',
          isInspector: true,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        });

        registerContainers(testContainerManager, workerStatsSnapshot, [
          /** foooo has been disappeared */
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ]);
        await testContainerManager.reconcileContainers();
        workerStatsSnapshot.sync(brokerData);

        const _turfContainerStateses = [
          TurfContainerStates.running,
          TurfContainerStates.unknown,
        ];
        const _containerStatus: ContainerStatus[] = [
          ContainerStatus.Ready,
          ContainerStatus.Unknown,
        ];
        const _pids = [2, 1];

        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.name, 'func');
          assert.strictEqual(broker.isInspector, inspectors[i]);
          assert.deepStrictEqual(
            broker.data,
            broker.profiles.get('func')!.toJSON(true)
          );
          assert.strictEqual(broker.workers.size, 1);
          assert.strictEqual(broker.startingPool.size, 0);

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
      });

      it('should sync that not in profile', async () => {
        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });

        await profileManager.set([], 'WAIT');

        registerContainers(testContainerManager, workerStatsSnapshot, [
          { pid: 1, name: 'foooo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.starting },
        ]);
        await testContainerManager.reconcileContainers();

        workerStatsSnapshot.sync([brokerData[1]]);

        const brokers = [
          workerStatsSnapshot.getBroker('func', true)!,
          workerStatsSnapshot.getBroker('func', false)!,
        ];
        const inspectors = [true, false];
        const workerNames = ['hello', 'foooo'];
        const workerCredentials = ['world', 'bar'];
        const turfContainerStates = [
          TurfContainerStates.starting,
          TurfContainerStates.running,
        ];
        const pids = [2, 1];

        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.name, 'func');
          assert.strictEqual(broker.isInspector, inspectors[i]);
          assert.strictEqual(broker.data, null);
          assert.strictEqual(broker.workers.size, 1);
          assert.strictEqual(broker.startingPool.size, 1);

          const worker = JSON.parse(
            JSON.stringify(broker.workers.get(workerNames[i]))
          );
          assert.deepStrictEqual(worker, {
            containerStatus: ContainerStatus.Created,
            turfContainerStates: turfContainerStates[i],
            name: workerNames[i],
            credential: workerCredentials[i],
            pid: pids[i],
            data:
              i === 0
                ? null
                : _.pick(JSON.parse(JSON.stringify(brokerData[i].workers[0])), [
                    'activeRequestCount',
                    'maxActivateRequests',
                  ]),
            registerTime: worker.registerTime,
          });
        });

        registerContainers(testContainerManager, workerStatsSnapshot, [
          { pid: 1, name: 'foooo', status: TurfContainerStates.stopped },
          { pid: 2, name: 'hello', status: TurfContainerStates.stopping },
        ]);
        await testContainerManager.reconcileContainers();
        workerStatsSnapshot.sync([brokerData[1]]);

        const _turfContainerStates = [
          TurfContainerStates.stopping,
          TurfContainerStates.stopped,
        ];

        brokers.forEach((broker, i) => {
          assert.strictEqual(broker.name, 'func');
          assert.strictEqual(broker.isInspector, inspectors[i]);
          assert.strictEqual(broker.data, null);
          assert.strictEqual(broker.workers.size, 1);
          assert.strictEqual(broker.startingPool.size, 0);

          const worker: Partial<Worker> = JSON.parse(
            JSON.stringify(broker.workers.get(workerNames[i]))
          );
          assert.deepStrictEqual(worker, {
            containerStatus: ContainerStatus.Stopped,
            turfContainerStates: _turfContainerStates[i],
            name: workerNames[i],
            credential: workerCredentials[i],
            pid: pids[i],
            data:
              i === 0
                ? null
                : _.pick(JSON.parse(JSON.stringify(brokerData[i].workers[0])), [
                    'activeRequestCount',
                    'maxActivateRequests',
                  ]),
            registerTime: worker.registerTime,
          });
        });
      });
    });

    describe('.correct()', () => {
      it('should correct gc stopped and unknown container', async () => {
        const spyFs = sinon.spy(fs.promises, 'rm');

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: true },
          disposable: false,
          toReserve: false,
        });

        workerStatsSnapshot.register({
          funcName: 'func',
          processName: 'foooo',
          credential: 'bar',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        });
        registerContainers(testContainerManager, workerStatsSnapshot, [
          { name: 'hello', pid: 1, status: TurfContainerStates.running },
          { name: 'foooo', pid: 1, status: TurfContainerStates.running },
        ]);

        updateWorkerContainerStatus(workerStatsSnapshot, {
          functionName: 'func',
          isInspector: true,
          event: ContainerStatusReport.ContainerInstalled,
          name: 'hello',
          requestId: '',
        });

        updateWorkerContainerStatus(workerStatsSnapshot, {
          functionName: 'func',
          isInspector: false,
          event: ContainerStatusReport.ContainerDisconnected,
          name: 'foooo',
          requestId: '',
        });

        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', true)!.workers.size,
          1
        );
        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', false)!.workers.size,
          1
        );

        // 回收 Stoppped
        await workerStatsSnapshot.correct();

        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', true)!.workers.size,
          1
        );
        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', false)!.workers.size,
          0
        );
        assert(testContainerManager.getContainer('foooo') == null);

        clock.tick(config.worker.gcLogDelay);
        assert(spyFs.calledWithMatch('/logs/workers/foooo'));

        registerContainers(testContainerManager, workerStatsSnapshot, [
          { pid: 2, name: 'hello', status: TurfContainerStates.unknown },
        ]);
        await testContainerManager.reconcileContainers();
        workerStatsSnapshot.sync(brokerData);

        // 回收 Unknown
        await workerStatsSnapshot.correct();

        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', true)!.workers.size,
          0
        );
        assert.strictEqual(
          workerStatsSnapshot.getBroker('func', false)!.workers.size,
          0
        );

        assert(testContainerManager.getContainer('hello') == null);

        clock.tick(config.worker.gcLogDelay);

        assert(spyFs.calledWithMatch('/logs/workers/hello'));

        await profileManager.set([], 'WAIT');

        workerStatsSnapshot.sync([]);

        // 配置更新后，回收无用 borker
        await workerStatsSnapshot.correct();

        assert.strictEqual(workerStatsSnapshot.getBroker('func', true), null);
        assert.strictEqual(workerStatsSnapshot.getBroker('func', false), null);

        spyFs.restore();
      });
    });

    describe('.close()', () => {
      it('should close gcQueue after close', async () => {
        await workerStatsSnapshot.close();
        assert(workerStatsSnapshot['gcQueue'].closed);
      });
    });
  });
});

function updateWorkerContainerStatus(
  snapshot: WorkerStatsSnapshot,
  report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
) {
  const { functionName, isInspector, name, event } = report;

  const worker = snapshot.getWorker(functionName, isInspector, name);

  if (worker) {
    worker.updateContainerStatusByEvent(event as ContainerStatusReport);

    // 如果已经 ready，则从 starting pool 中移除
    if (worker.containerStatus === ContainerStatus.Ready) {
      const broker = snapshot.getBroker(functionName, isInspector);
      broker?.removeItemFromStartingPool(worker.name);
    }
  }
}
