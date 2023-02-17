import assert from 'assert';
import mm from 'mm';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { ControlPlane } from '#self/control_plane/index';
import { DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager';
import { mockClientCreatorForManager } from '#self/test/util';
import { CapacityManager } from '#self/control_plane/capacity_manager';
import { TurfContainerStates } from '#self/lib/turf/types';
import { ContainerStatusReport } from '#self/lib/constants';
import {
  registerContainers,
  TestContainerManager,
} from './test_container_manager';
import { StateManager } from '../worker_stats/state_manager';
import { WorkerStatusReportEvent } from '../events';
import { registerWorkers } from './util';

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
  let stateManager: StateManager;

  beforeEach(async () => {
    mockClientCreatorForManager(DataPlaneClientManager);
    clock = common.createTestClock({
      shouldAdvanceTime: true,
    });
    testContainerManager = new TestContainerManager(clock);
    control = new ControlPlane(config, {
      clock,
      containerManager: testContainerManager,
    });
    await control.ready();
    ({ capacityManager, stateManager } = control);
  });

  afterEach(async () => {
    mm.restore();
    await control.close();
    clock.uninstall();
  });

  describe('get #virtualMemoryUsed()', () => {
    it('should get virtual memory used', async () => {
      await control.functionProfile.set(
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

      registerWorkers(stateManager.workerStatsSnapshot, [
        {
          funcName: 'func',
          processName: 'hello',
          credential: 'world',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          funcName: 'func',
          processName: 'foo',
          credential: 'barworld',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          funcName: 'lambda',
          processName: 'coco',
          credential: 'nut',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          // 未 ready 不计入 virtual memory size
          funcName: 'lambda',
          processName: 'cocos',
          credential: '2d',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
        {
          funcName: 'lambda',
          processName: 'alibaba',
          credential: 'seed of hope',
          options: { inspect: false },
          disposable: false,
          toReserve: false,
        },
      ]);

      registerContainers(
        testContainerManager,
        stateManager.workerStatsSnapshot,
        [
          { pid: 1, name: 'hello', status: TurfContainerStates.running },
          { pid: 2, name: 'foo', status: TurfContainerStates.running },
          { pid: 3, name: 'coco', status: TurfContainerStates.running },
          { pid: 4, name: 'cocos', status: TurfContainerStates.running },
          { pid: 5, name: 'alibaba', status: TurfContainerStates.running },
        ]
      );

      await control.stateManager.syncWorkerData([brokerData1, brokerData2]);

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func',
          name: 'hello',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'func',
          name: 'foo',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'lambda',
          name: 'coco',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      stateManager.updateWorkerStatusByReport(
        new WorkerStatusReportEvent({
          functionName: 'lambda',
          name: 'alibaba',
          isInspector: false,
          event: ContainerStatusReport.ContainerInstalled,
          requestId: '',
        })
      );

      assert.strictEqual(
        capacityManager.virtualMemoryUsed,
        512000000 * 2 + 128000000 * 2
      );
    });
  });
});
