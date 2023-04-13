import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import { Broker } from '#self/control_plane/worker_stats/broker';
import * as common from '#self/test/common';
import { config } from '#self/config';
import {
  FunctionProfileManager as ProfileManager,
  FunctionProfileManagerContext,
  FunctionProfileManagerEvents,
} from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import { WorkerStatus, WorkerStatusReport } from '#self/lib/constants';
import {
  registerBrokerContainers,
  TestContainerManager,
} from '../test_container_manager';
import { registerWorkers } from '../util';
import { DependencyContext } from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';
import { funcData } from './test_data';
import sinon from 'sinon';

describe(common.testName(__filename), () => {
  let profileManager: ProfileManager;
  beforeEach(async () => {
    const ctx = new DependencyContext<FunctionProfileManagerContext>();
    ctx.bindInstance('config', config);
    ctx.bindInstance(
      'eventBus',
      new EventBus([...FunctionProfileManagerEvents])
    );
    profileManager = new ProfileManager(ctx);
    await profileManager.setProfiles(funcData);
  });
  afterEach(() => {
    mm.restore();
  });

  describe('Broker', () => {
    describe('constructor', () => {
      it('should constructor', () => {
        const broker = new Broker(profileManager.getProfile('func')!, true);
        assert.ok(broker instanceof Broker);
        assert.strictEqual(broker.redundantTimes, 0);
        assert.strictEqual(broker.name, 'func');
        assert.strictEqual(broker.isInspector, true);
        assert.strictEqual(broker.workers.size, 0);
      });
    });

    describe('.getWorker()', () => {
      it('should get worker', () => {
        const broker = new Broker(profileManager.getProfile('func')!, true);
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
        const broker = new Broker(profileManager.getProfile('func')!, true);
        registerWorkers(broker, [
          {
            processName: 'foo',
            credential: 'bar',
          },
        ]);

        assert.strictEqual(broker.workers.size, 1);
        assert.strictEqual(broker.initiatingWorkerCount, 1);

        const worker = JSON.parse(JSON.stringify(broker.getWorker('foo')));
        assert.deepStrictEqual(worker, {
          containerStatus: WorkerStatus.Created,
          turfContainerStates: null,
          name: 'foo',
          credential: 'bar',
          pid: null,
          data: null,
          registerTime: worker.registerTime,
        });
      });
    });

    describe('get .initiatingWorkerCount()', () => {
      it('should return initiating worker counts', () => {
        const broker = new Broker(profileManager.getProfile('func')!, true);
        assert.strictEqual(broker.initiatingWorkerCount, 0);

        registerWorkers(broker, [
          {
            processName: 'coco',
            credential: 'nut',
          },
        ]);
        assert.strictEqual(broker.initiatingWorkerCount, 1);
      });
    });

    describe('getters', () => {
      let broker: Broker;
      beforeEach(() => {
        broker = new Broker(profileManager.getProfile('func')!, false);
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
            // maxActivateRequests: 10,
            activeRequestCount: 7,
          },
          {
            name: 'foo',
            // maxActivateRequests: 10,
            activeRequestCount: 4,
          },
        ]);
      });

      describe('get .activeWorkerCount()', () => {
        it('should get when no initiating workers', () => {
          assert.strictEqual(broker.activeWorkerCount, 2);
        });

        it('should not get in having initiating workers', () => {
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'world',
            },
          ]);
          assert.strictEqual(broker.activeWorkerCount, 2);
          assert.strictEqual(broker.initiatingWorkerCount, 1);
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
              // maxActivateRequests: 10,
              activeRequestCount: 7,
            },
            {
              name: 'foo',
              // maxActivateRequests: 10,
              activeRequestCount: 4,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateWorkerStatusByReport(
                WorkerStatusReport.ContainerDisconnected
              );
            }
          });

          assert.strictEqual(broker.activeWorkerCount, 1);
        });
      });

      describe('get .virtualMemory()', () => {
        it('should get virtualMemory with initiating workers, ignore initiating workers', () => {
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
              // maxActivateRequests: 10,
              activeRequestCount: 7,
            },
            {
              name: 'foo',
              // maxActivateRequests: 10,
              activeRequestCount: 4,
            },
            {
              name: 'coco',
              // maxActivateRequests: 10,
              activeRequestCount: 0,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateWorkerStatusByReport(
                WorkerStatusReport.ContainerDisconnected
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

          broker
            .getWorker('coco')
            ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

          broker.sync([
            {
              name: 'hello',
              // maxActivateRequests: 10,
              activeRequestCount: 7,
            },
            {
              name: 'foo',
              // maxActivateRequests: 10,
              activeRequestCount: 4,
            },
            {
              name: 'coco',
              // maxActivateRequests: 10,
              activeRequestCount: 0,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateWorkerStatusByReport(
                WorkerStatusReport.ContainerDisconnected
              );
            }
          });
          assert.strictEqual(broker.totalMaxActivateRequests, 20);
        });
      });

      describe('.getActiveRequestCount()', () => {
        it('should get activeRequestCount', () => {
          assert.strictEqual(broker.getActiveRequestCount(), 11);
          registerWorkers(broker, [
            {
              processName: 'coco',
              credential: 'nut',
            },
          ]);
          assert.strictEqual(broker.getActiveRequestCount(), 11);

          broker
            .getWorker('coco')
            ?.updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

          broker.sync([
            {
              name: 'hello',
              // maxActivateRequests: 10,
              activeRequestCount: 7,
            },
            {
              name: 'foo',
              // maxActivateRequests: 10,
              activeRequestCount: 4,
            },
            {
              name: 'coco',
              // maxActivateRequests: 10,
              activeRequestCount: 2,
            },
          ]);
          broker.workers.forEach(worker => {
            if (worker.name === 'hello') {
              worker.updateWorkerStatusByReport(
                WorkerStatusReport.ContainerDisconnected
              );
            }
          });
          assert.strictEqual(broker.getActiveRequestCount(), 6);
        });
      });

      describe('get reservationCount', () => {
        it('should get 1 when isInspector is true', () => {
          broker = new Broker(profileManager.getProfile('func')!, true);

          assert.strictEqual(broker.reservationCount, 1);
        });

        it('should get from worker config', () => {
          broker = new Broker(profileManager.getProfile('func')!, false);

          sinon.stub(broker.profile.worker, 'reservationCount').value(10);

          assert.strictEqual(broker.reservationCount, 10);
        });
      });

      describe('get memoryLimit', () => {
        it('should get from worker config', () => {
          broker = new Broker(profileManager.getProfile('func')!, false);

          sinon.stub(broker.profile.resourceLimit, 'memory').value(100);

          assert.strictEqual(broker.memoryLimit, 100);
        });
      });
    });

    describe('.sync()', () => {
      it('should sync', () => {
        const testContainerManager = new TestContainerManager();
        const broker = new Broker(profileManager.getProfile('func')!, true);
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
          .getWorker('hello')!
          .updateWorkerStatusByReport(WorkerStatusReport.ContainerInstalled);

        registerBrokerContainers(testContainerManager, broker, [
          { pid: 1, name: 'foo', status: TurfContainerStates.running },
          { pid: 2, name: 'hello', status: TurfContainerStates.running },
        ]);
        testContainerManager.reconcileContainers();
        broker.sync([
          {
            name: 'hello',
            // maxActivateRequests: 10,
            activeRequestCount: 7,
          },
          {
            name: 'non-exists',
            // maxActivateRequests: 10,
            activeRequestCount: 1,
          },
        ]);

        assert.strictEqual(broker.initiatingWorkerCount, 1);

        assert.strictEqual(broker.workers.size, 2);
        const workers = [
          {
            containerStatus: WorkerStatus.Ready,
            turfContainerStates: TurfContainerStates.running,
            name: 'hello',
            credential: 'world',
            pid: 2,
            data: {
              activeRequestCount: 7,
            },
          },
          {
            containerStatus: WorkerStatus.Created,
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
    });
  });
});
