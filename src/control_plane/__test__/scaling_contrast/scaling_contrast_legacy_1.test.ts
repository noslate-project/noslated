import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { ControlPlane } from '#self/control_plane';
import { DefaultController } from '#self/control_plane/controllers';
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
    config: common.extendDefaultConfig({
      virtualMemoryPoolSize: '2gb',
      controlPlane: {
        workerTrafficStatsPullingMs: 1000,
        workerRedundantVictimSpareTimes: 60,
      },
    }),
  });

  let controlPlane: ControlPlane;
  let stateManager: StateManager;
  let functionProfile: FunctionProfileManager;
  let workerLauncher: WorkerLauncher;
  let defaultController: DefaultController;

  beforeEach(async () => {
    controlPlane = env.control;
    stateManager = controlPlane._ctx.getInstance('stateManager');
    functionProfile = controlPlane._ctx.getInstance('functionProfile');
    workerLauncher = controlPlane._ctx.getInstance('workerLauncher');
    defaultController = controlPlane._ctx.getInstance('defaultController');
  });

  /**
   * 对照场景一：
   * 对照原始扩容方案，当设置 1s 拉取一次，拉取 60 次，此时该方案遇到 brust 流量会扩容较多
   */
  it('legacy scaling when brust traffic', async () => {
    // concurrency brust 10
    // legacy will expand 9 worker
    // ema will expand 1 worker
    await initWorker(functionProfile, env, stateManager);

    await env.testClock.tickAsync(1000);

    // brust 10
    await stateManager._syncBrokerData([
      generateBrokerData('aworker_echo', 'aworker_echo_1', 10),
    ]);

    let tryLaunchCalled = 0;

    const stubTryLaunch = sinon
      .stub(workerLauncher, 'tryLaunch')
      .callsFake(async () => {
        tryLaunchCalled++;
      });

    await defaultController['autoScale']();

    assert.strictEqual(tryLaunchCalled, 9);

    tryLaunchCalled = 0;
    stubTryLaunch.restore();
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
    concurrency: activeRequestCount,
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
