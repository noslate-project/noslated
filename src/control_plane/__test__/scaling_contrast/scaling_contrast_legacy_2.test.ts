import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { ControlPlane } from '#self/control_plane';
import { DefaultController } from '#self/control_plane/controllers';
import { DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager';
import { WorkerStatusReportEvent } from '#self/control_plane/events';
import { WorkerLauncher } from '#self/control_plane/worker_launcher';
import { StateManager } from '#self/control_plane/worker_stats/state_manager';
import { WorkerStatusReport } from '#self/lib/constants';
import { FunctionProfileManager } from '#self/lib/function_profile';
import { TurfContainerStates } from '#self/lib/turf';
import { DeepRequired } from '#self/lib/util';
import sinon from 'sinon';
import { TestEnvironment } from '../environment';
import { registerWorkers } from '../util';
import { noslated } from '#self/proto/root';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new TestEnvironment({
    createTestClock: true,
  });

  let controlPlane: ControlPlane;
  let stateManager: StateManager;
  let functionProfile: FunctionProfileManager;
  let workerLauncher: WorkerLauncher;
  let dataPlaneClientManager: DataPlaneClientManager;
  let defaultController: DefaultController;

  beforeEach(async () => {
    controlPlane = env.control;
    stateManager = controlPlane._ctx.getInstance('stateManager');
    functionProfile = controlPlane._ctx.getInstance('functionProfile');
    workerLauncher = controlPlane._ctx.getInstance('workerLauncher');
    dataPlaneClientManager = controlPlane._ctx.getInstance(
      'dataPlaneClientManager'
    );
    defaultController = controlPlane._ctx.getInstance('defaultController');
  });

  /**
   * 对照场景二：
   * 对照原始扩容方案，当设置 10s 拉取一次，拉取 6 次，此时该方案如果第六次为 0，则会选择缩容。
   */
  it('legacy scaling when traffic down to 0', async () => {
    // concurrency decline 0
    // legacy will shrink 1 worker
    // ema will keep worker
    await initWorker(functionProfile, env, stateManager);

    // down to 0
    await stateManager._syncBrokerData([
      generateBrokerData('aworker_echo', 'aworker_echo_1', 0),
    ]);

    stateManager.getBroker('aworker_echo', false)!.redundantTimes = 6;

    let reduceCapacityCalled = 0;

    const stubReduceCapacity = sinon
      .stub(dataPlaneClientManager, 'reduceCapacity')
      .callsFake(async (data: any) => {
        const brokers = data.brokers;

        assert.strictEqual(brokers.length, 1);
        assert.strictEqual(brokers[0].functionName, 'aworker_echo');

        reduceCapacityCalled++;
        return [];
      });

    await defaultController['autoScale']();
    assert.strictEqual(reduceCapacityCalled, 1);

    stubReduceCapacity.restore();
  });
});

function generateBrokerData(
  funcName: string,
  workerName: string,
  activeRequestCount: number
): DeepRequired<noslated.data.IBrokerStats> {
  return {
    functionName: funcName,
    inspector: false,
    workers: [
      {
        name: workerName,
        activeRequestCount,
      },
    ],
  };
}

async function initWorker(
  functionProfile: FunctionProfileManager,
  env: TestEnvironment,
  stateManager: StateManager
) {
  await functionProfile.setProfiles([
    {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        maxActivateRequests: 1,
      },
      resourceLimit: {
        memory: 200 * 1024 * 1024,
      },
    },
  ]);

  env.containerManager.setTestContainers([
    {
      pid: 1,
      name: 'aworker_echo_1',
      status: TurfContainerStates.running,
    },
  ]);

  registerWorkers(stateManager, [
    {
      funcName: 'aworker_echo',
      processName: 'aworker_echo_1',
      credential: 'aworker_echo_1',
      options: { inspect: false },
      toReserve: false,
    },
  ]);

  stateManager._updateWorkerStatusByReport(
    new WorkerStatusReportEvent({
      functionName: 'aworker_echo',
      name: 'aworker_echo_1',
      isInspector: false,
      event: WorkerStatusReport.ContainerInstalled,
    })
  );
}
