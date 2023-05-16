import assert from 'assert';

import * as common from '#self/test/common';
import {
  FunctionProfileManager,
  FunctionProfileManagerContext,
  FunctionProfileManagerEvents,
} from '#self/lib/function_profile';
import { WorkerBroker } from '../worker_broker';
import { kMegaBytes } from '#self/control_plane/constants';
import { DataFlowController } from '../data_flow_controller';
import { DependencyContext } from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';
import { config } from '#self/config';

const PROFILES = [
  {
    name: 'node-http-demo',
    runtime: 'nodejs',
    url: 'https://noslate-release.oss-cn-hangzhou.aliyuncs.com/demo/node-http-demo.zip',
    handler: 'index.handler',
    initializer: 'index.initializer',
    signature: '0F32CEE2035C23F134E27FCE7D2BC87D',
    resourceLimit: {
      memory: 300 * kMegaBytes,
    },
    worker: {
      initializationTimeout: 500,
      maxActivateRequests: 10,
    },
  },
  {
    name: 'hello',
    runtime: 'aworker',
    url: 'https://noslate-release.oss-cn-hangzhou.aliyuncs.com/demo/aworker-echo.zip',
    sourceFile: 'index.js',
    signature: '6D3ADBE5392F1805C163D3DFC5B30FCE',
    worker: {
      reservationCount: 1,
    },
  },
];

const mockHost = {
  broadcastContainerStatusReport() {},
};

describe(common.testName(__filename), () => {
  describe('WorkerBroker#bindWorker', async () => {
    let profileManager: FunctionProfileManager;

    beforeEach(async () => {
      const ctx = new DependencyContext<FunctionProfileManagerContext>();
      ctx.bindInstance('config', config);
      ctx.bindInstance(
        'eventBus',
        new EventBus([...FunctionProfileManagerEvents])
      );
      profileManager = new FunctionProfileManager(ctx);
      await profileManager.setProfiles(PROFILES as any);
    });

    it('all default', async () => {
      let triggerCalled = false;
      const delegate = {
        async trigger(credential: any, method: any, data: any, metadata: any) {
          assert.ok(
            metadata.deadline - Date.now() <=
              config.worker.defaultInitializerTimeout
          );
          triggerCalled = true;
        },
        resetPeer() {},
      };

      const profiles = JSON.parse(JSON.stringify(PROFILES));
      delete profiles[0].worker;
      await profileManager.setProfiles(profiles);
      const broker = new WorkerBroker(
        {
          delegate,
          host: mockHost,
        } as unknown as DataFlowController,
        profileManager.getProfile('node-http-demo')!,
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      assert.strictEqual(broker.workerCount, 1);
      assert(triggerCalled);
    });
  });
});
