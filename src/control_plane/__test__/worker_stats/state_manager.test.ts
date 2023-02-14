import path from 'path';
import * as fs from 'fs';
import assert from 'assert';

import mm from 'mm';
import _ from 'lodash';

import * as common from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import { ContainerStatus, ContainerStatusReport } from '#self/lib/constants';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import { workerLogPath } from '#self/control_plane/container/container_manager';
import { WorkerStatusReportEvent } from '#self/control_plane/events';
import { registerContainers } from '../test_container_manager';
import { TurfContainerStates } from '#self/lib/turf';
import sinon from 'sinon';
import { Broker, Worker } from '#self/control_plane/worker_stats';
import { TestEnvironment } from '../environment';

describe(common.testName(__filename), () => {
  let stateManager: StateManager;

  const env = new TestEnvironment({
    createTestClock: true,
  });
  let controlPlane: ControlPlane;

  beforeEach(async () => {
    controlPlane = env.control;

    ({ stateManager } = controlPlane);
  });

  describe('updateContainerStatusByReport()', () => {
    it('should update regularly', async () => {
      await controlPlane.functionProfile.set(
        [
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
        ],
        'WAIT'
      );

      stateManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'cred1',
        false
      );
      stateManager.workerStatsSnapshot.register(
        'func2',
        'worker1',
        'cred1',
        false
      );

      const worker1 = stateManager.workerStatsSnapshot.getWorker(
        'func1',
        false,
        'worker1'
      );
      const worker2 = stateManager.workerStatsSnapshot.getWorker(
        'func2',
        false,
        'worker1'
      );

      assert(worker1);
      assert(worker2);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Ready);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: 'Unknown state',
          requestId: '',
        })
      );

      assert.strictEqual(worker1.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func2',
          name: 'worker1',
          isInspector: false,
          event: 'Unknown state',
          requestId: '',
        })
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func2',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerDisconnected,
          requestId: '',
        })
      );

      assert.strictEqual(worker2.containerStatus, ContainerStatus.Unknown);
    });

    it('should not update with illegal ContainerStatusReport order', async () => {
      await controlPlane.functionProfile.set(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      stateManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'cred1',
        false
      );

      const worker = stateManager.workerStatsSnapshot.getWorker(
        'func1',
        false,
        'worker1'
      );

      assert(worker);

      assert.rejects(
        async () => {
          await worker.ready();
        },
        {
          message: /stopped unexpected after start./,
        }
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.RequestDrained,
          requestId: '',
        })
      );

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func1',
          name: 'worker1',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(worker.containerStatus, ContainerStatus.Stopped);
    });
  });

  describe('#syncWorkerData()', () => {
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

    it('should sync', async () => {
      await controlPlane.functionProfile.set(
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

      stateManager.workerStatsSnapshot.register(
        'func',
        'hello',
        'world',
        false
      );
      stateManager.workerStatsSnapshot.register('func', 'foo', 'bar', false);

      registerContainers(
        env.containerManager,
        stateManager.workerStatsSnapshot,
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

      const syncSpy = sinon.spy(stateManager.workerStatsSnapshot, 'sync');
      const correctSpy = sinon.spy(stateManager.workerStatsSnapshot, 'correct');

      let workerStoppedBroker!: Broker;
      let workerStoppedWorker!: Worker;
      stateManager.workerStatsSnapshot.on(
        'workerStopped',
        (emitExceptionMessage, state, broker, worker) => {
          assert.strictEqual(emitExceptionMessage, undefined);
          workerStoppedWorker = worker;
          workerStoppedBroker = broker;
        }
      );

      await stateManager.syncWorkerData([brokerData1]);

      assert(syncSpy.called);
      assert(correctSpy.called);
      assert.ok(env.containerManager.getContainer('foo') == null);

      assert.strictEqual(stateManager.workerStatsSnapshot.brokers.size, 1);
      const broker = stateManager.workerStatsSnapshot.getBroker('func', false);

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
              stateManager.workerStatsSnapshot.config.logger.dir,
              'foo',
              'dummy'
            )
          )
        );
        assert.deepStrictEqual(options, { recursive: true });
        rmCalled = true;
      });

      env.testClock.tick(10 * 1000 * 60);
      assert(rmCalled);
    });
  });

  describe('syncWorkerData()', () => {
    it('should sync', async () => {
      await controlPlane.functionProfile.set(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

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

      stateManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'id1',
        false
      );
      stateManager.workerStatsSnapshot.register(
        'func1',
        'worker2',
        'id2',
        false
      );

      registerContainers(
        env.containerManager,
        stateManager.workerStatsSnapshot,
        [
          { name: 'worker1', status: TurfContainerStates.running, pid: 123 },
          { name: 'worker2', status: TurfContainerStates.running, pid: 124 },
        ]
      );
      await stateManager.syncWorkerData([brokerStat1]);

      assert.strictEqual(stateManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        stateManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        2
      );

      assert.deepStrictEqual(
        _.omit(
          stateManager.workerStatsSnapshot
            .getBroker('func1', false)!
            .getWorker('worker1')!
            .toJSON(),
          'pid',
          'registerTime'
        ),
        {
          name: 'worker1',
          credential: 'id1',
          turfContainerStates: 'running',
          containerStatus: ContainerStatus.Created,
          data: { maxActivateRequests: 10, activeRequestCount: 1 },
        }
      );
      {
        const worker2 = stateManager.workerStatsSnapshot
          .getBroker('func1', false)!
          .getWorker('worker2');
        assert(worker2);
        assert.deepStrictEqual(
          _.omit(worker2.toJSON(), 'pid', 'registerTime'),
          {
            name: 'worker2',
            credential: 'id2',
            turfContainerStates: 'running',
            containerStatus: ContainerStatus.Created,
            data: { maxActivateRequests: 10, activeRequestCount: 6 },
          }
        );

        await env.containerManager.getContainer('worker2')!.stop();
        await stateManager.syncWorkerData([brokerStat1]);
      }

      assert.strictEqual(stateManager.workerStatsSnapshot.brokers.size, 1);
      assert.strictEqual(
        stateManager.workerStatsSnapshot.getBroker('func1', false)!.workers
          .size,
        1
      );
      assert.deepStrictEqual(
        stateManager.workerStatsSnapshot
          .getBroker('func1', false)!
          .getWorker('worker2'),
        null
      );

      // should delete directory after 5 minutes.
      let rmCalled = false;
      mm(fs.promises, 'rm', async (name: any, options: any) => {
        assert.strictEqual(
          name,
          path.dirname(
            workerLogPath(stateManager['config'].logger.dir, 'worker2', 'dummy')
          )
        );
        assert.deepStrictEqual(options, { recursive: true });
        rmCalled = true;
      });

      env.testClock.tick(10 * 1000 * 60);
      assert(rmCalled);
    });

    it('should not sync with empty psData', async () => {
      await controlPlane.functionProfile.set(
        [
          {
            name: 'func1',
            url: `file://${__dirname}`,
            runtime: 'aworker',
            signature: 'xxx',
            sourceFile: 'index.js',
          },
        ],
        'WAIT'
      );

      const brokerStat1 = {
        functionName: 'func1',
        inspector: false,
        workers: [
          {
            name: 'worerk1',
            maxActivateRequests: 10,
            activeRequestCount: 1,
          },
        ],
      };

      stateManager.workerStatsSnapshot.register(
        'func1',
        'worker1',
        'id1',
        false
      );

      const beforeSync = stateManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      await stateManager.syncWorkerData([brokerStat1]);

      const afterSync = stateManager.workerStatsSnapshot
        .getBroker('func1', false)!
        .getWorker('worker1')!
        .toJSON();

      assert.deepStrictEqual(beforeSync, afterSync);
    });
  });
});
