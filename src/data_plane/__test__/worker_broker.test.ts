import assert from 'assert';

import * as common from '#self/test/common';
import { findResponseHeaderValue } from '#self/test/util';
import {
  FunctionProfileManager,
  FunctionProfileManagerContext,
  FunctionProfileUpdateEvent,
} from '#self/lib/function_profile';
import { PendingRequest, WorkerBroker } from '../worker_broker';
import { kMegaBytes } from '#self/control_plane/constants';
import { DataFlowController } from '../data_flow_controller';
import { Metadata } from '#self/delegate/request_response';
import { createDeferred, sleep, bufferFromStream } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { Worker } from '#self/data_plane/worker_broker';
import * as sinon from 'sinon';
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
      maxActivateRequests: 1,
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
      ctx.bindInstance('eventBus', new EventBus([FunctionProfileUpdateEvent]));
      profileManager = new FunctionProfileManager(ctx);
      await profileManager.set(PROFILES as any, 'IMMEDIATELY');
    });

    it('all default', async () => {
      let triggerCalled = false;
      const delegate = {
        async trigger(credential: any, method: any, data: any, metadata: any) {
          assert.deepStrictEqual(metadata, { timeout: 5000 });
          triggerCalled = true;
        },
        resetPeer() {},
      };

      const profiles = JSON.parse(JSON.stringify(PROFILES));
      delete profiles[0].worker;
      await profileManager.set(profiles, 'IMMEDIATELY');
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate,
          config: {
            worker: {
              maxActivateRequests: 10,
              defaultInitializerTimeout: 5000,
            },
          },
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      assert.strictEqual(broker.workers.length, 1);
      const worker = broker.workers[0];

      assert.strictEqual(worker.maxActivateRequests, 10);
      assert(triggerCalled);
    });

    it('maxActivateRequests 1', async () => {
      let triggerCalled = false;
      const delegate = {
        async trigger(credential: any, method: any, data: any, metadata: any) {
          assert.deepStrictEqual(metadata, { timeout: 5000 });
          triggerCalled = true;
        },
        resetPeer() {},
      };

      const profiles = JSON.parse(JSON.stringify(PROFILES));
      delete profiles[0].worker.initializationTimeout;
      await profileManager.set(profiles, 'IMMEDIATELY');
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate,
          config: {
            worker: {
              maxActivateRequests: 10,
              defaultInitializerTimeout: 5000,
            },
          },
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      assert.strictEqual(broker.workers.length, 1);
      const worker = broker.workers[0];

      assert.strictEqual(worker.maxActivateRequests, 1);
      assert(triggerCalled);
    });

    it('initialize timeout 500', async () => {
      let triggerCalled = false;
      const delegate = {
        async trigger(credential: any, method: any, data: any, metadata: any) {
          assert.deepStrictEqual(metadata, { timeout: 500 });
          triggerCalled = true;
        },
        resetPeer() {},
      };

      const profiles = JSON.parse(JSON.stringify(PROFILES));
      delete profiles[0].worker.maxActivateRequests;
      await profileManager.set(profiles, 'IMMEDIATELY');
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate,
          config: {
            worker: {
              maxActivateRequests: 10,
              defaultInitializerTimeout: 5000,
            },
          },
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      assert.strictEqual(broker.workers.length, 1);
      const worker = broker.workers[0];

      assert.strictEqual(worker.maxActivateRequests, 10);
      assert(triggerCalled);
    });
  });

  describe('WorkerBroker#getAvailableWorker', () => {
    const dummyDelegate = {
      async trigger() {
        /* empty */
      },
      resetPeer() {},
    };

    let profileManager: FunctionProfileManager;

    beforeEach(async () => {
      const ctx = new DependencyContext<FunctionProfileManagerContext>();
      ctx.bindInstance('config', config);
      ctx.bindInstance('eventBus', new EventBus([FunctionProfileUpdateEvent]));
      profileManager = new FunctionProfileManager(ctx);
      await profileManager.set(PROFILES as any, 'IMMEDIATELY');
    });

    it('no worker', async () => {
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate: dummyDelegate,
          config: require('#self/config'),
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );
      assert.strictEqual(broker.getAvailableWorker(), null);
    });

    it('no `traffic on` worker', async () => {
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate: dummyDelegate,
          config: require('#self/config'),
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      broker.registerCredential('hello', 'world');
      await broker.bindWorker('world');

      await Promise.all(broker.workers.map(worker => worker.closeTraffic()));
      assert.strictEqual(broker.getAvailableWorker(), null);
    });

    it('no `traffic on` worker and idle worker', async () => {
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate: dummyDelegate,
          config: require('#self/config'),
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      broker.registerCredential('hello', 'world');
      await broker.bindWorker('world');

      await Promise.all(broker.workers.map(worker => worker.closeTraffic()));

      broker.registerCredential('coco', 'nut');
      await broker.bindWorker('nut');
      broker.workers[2].maxActivateRequests = 10;
      broker.workers[2].activeRequestCount = 10;

      assert.strictEqual(broker.getAvailableWorker(), null);
    });

    it('return idlest worker', async () => {
      const broker = new WorkerBroker(
        {
          profileManager,
          delegate: dummyDelegate,
          config: require('#self/config'),
          host: mockHost,
        } as unknown as DataFlowController,
        'node-http-demo',
        {}
      );

      broker.registerCredential('foo', 'bar');
      await broker.bindWorker('bar');

      broker.registerCredential('hello', 'world');
      await broker.bindWorker('world');

      broker.registerCredential('coco', 'nut');
      await broker.bindWorker('nut');

      broker.workers[0].maxActivateRequests = 10;
      broker.workers[0].activeRequestCount = 6;
      broker.workers[1].maxActivateRequests = 10;
      broker.workers[1].activeRequestCount = 3;
      broker.workers[2].maxActivateRequests = 10;
      broker.workers[2].activeRequestCount = 9;

      assert.strictEqual(broker.getAvailableWorker(), broker.workers[1]);
    });
  });

  describe('tryConsumeQueue', () => {
    const env = new DefaultEnvironment();

    it('should consume request queue', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
          },
        },
      ]);

      await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      });

      const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
      const dpWorker = dpBroker.workers[0];

      for (let i = 0; i < 5; i++) {
        dpBroker.requestQueue.push(
          new PendingRequest(
            Buffer.from('ok'),
            new Metadata({ method: 'POST' }),
            10000
          )
        );
      }

      assert.strictEqual(dpBroker.requestQueue.length, 5);

      dpBroker.tryConsumeQueue(dpWorker);

      // wait request drained
      // TODO：使用更明确地方式保证队列清空
      await sleep(1000);

      assert.strictEqual(dpBroker.requestQueue.length, 0);
    });

    it('should not continue deal request when worker traffic off', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_echo`,
          sourceFile: 'sleep.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
          },
        },
      ]);

      await env.agent.invoke('aworker_echo', Buffer.from('200'), {
        method: 'POST',
      });

      const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;

      const defer = createDeferred<void>();

      assert.strictEqual(dpBroker.workers.length, 1);

      let times = 0;
      const dpWorker = dpBroker.workers[0];

      const interval = setInterval(async () => {
        if (times === 10) {
          // 等待 worker 关闭流量
          await env.control._ctx
            .getInstance('dataPlaneClientManager')
            .reduceCapacity({
              brokers: [
                {
                  functionName: 'aworker_echo',
                  inspector: false,
                  workers: [
                    {
                      name: dpWorker.name,
                      credential: dpWorker.credential,
                    },
                  ],
                },
              ],
            });

          // worker traffic off
          defer.resolve();
        }

        dpBroker.requestQueue.push(
          new PendingRequest(
            Buffer.from('200'),
            new Metadata({ method: 'POST' }),
            10000
          )
        );
        times++;
      }, 100);

      // 堆积一些请求
      await sleep(500);

      // 触发队列消费
      dpBroker.tryConsumeQueue(dpWorker);

      await defer.promise;

      clearInterval(interval);

      // stop consume requestQueue
      assert(dpBroker.requestQueue.length > 0);
    });
  });

  describe('DisposableWorker', () => {
    const env = new DefaultEnvironment();

    it('should stop worker after invoke success', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
            disposable: true,
          },
        },
      ]);

      await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      });

      const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
      const dpWorker = dpBroker.workers[0];

      assert.strictEqual(dpWorker.trafficOff, true);

      await sleep(1000);

      assert.strictEqual(dpBroker.workers.length, 0);
    });

    it('should maxActivateRequests = 1 when disposable = true', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
            disposable: true,
          },
        },
      ]);

      const workerIds = new Set();

      await Promise.all([
        env.agent.invoke('aworker_echo', Buffer.from('ok'), {
          method: 'POST',
        }),
        env.agent.invoke('aworker_echo', Buffer.from('ok'), {
          method: 'POST',
        }),
        env.agent.invoke('aworker_echo', Buffer.from('ok'), {
          method: 'POST',
        }),
      ]).then(results => {
        for (const result of results) {
          const value = findResponseHeaderValue(result, 'x-noslate-worker-id');

          if (value) {
            workerIds.add(value);
          }
        }
      });

      assert.strictEqual(workerIds.size, 3);

      const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;

      await sleep(1000);

      assert.strictEqual(dpBroker.workers.length, 0);
    });

    it('should stop worker after invoke fail', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
            disposable: true,
          },
        },
      ]);

      const stub = sinon.stub(Worker.prototype, 'pipe').callsFake(async () => {
        throw new Error('MockWorkerPipeError');
      });

      await assert.rejects(async () => {
        await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
          method: 'POST',
        });
      }, /MockWorkerPipeError/);

      const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
      const dpWorker = dpBroker.workers[0];

      assert.strictEqual(dpWorker.trafficOff, true);

      await sleep(1000);

      assert.strictEqual(dpBroker.workers.length, 0);

      stub.restore();
    });

    it('should wait response sent', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_huge_response',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_huge_response`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
            disposable: true,
          },
        },
      ]);

      const size = 1024 * 1024 * 5;

      const response = await env.agent.invoke(
        'aworker_huge_response',
        Buffer.from(String(size)),
        {
          method: 'POST',
        }
      );

      const responseSizeStr =
        findResponseHeaderValue(response, 'x-response-size') || '';
      const responseSize = parseInt(responseSizeStr, 10);

      const data = await bufferFromStream(response);

      assert.strictEqual(data.length, responseSize);

      const dpBroker = env.data.dataFlowController.getBroker(
        'aworker_huge_response'
      )!;
      const dpWorker = dpBroker.workers[0];

      assert.strictEqual(dpWorker.trafficOff, true);

      await sleep(1000);

      assert.strictEqual(dpBroker.workers.length, 0);
    });

    it('should stop worker when response sent fail', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_huge_response',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_huge_response`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          worker: {
            maxActivateRequests: 10,
            disposable: true,
          },
        },
      ]);

      const size = 1024 * 1024 * 8;

      const response = await env.data.dataFlowController.invoke(
        'aworker_huge_response',
        Buffer.from(String(size)),
        new Metadata({})
      );

      response.destroy();

      const dpBroker = env.data.dataFlowController.getBroker(
        'aworker_huge_response'
      )!;
      const dpWorker = dpBroker.workers[0];
      assert.strictEqual(dpWorker.trafficOff, true);

      await sleep(1000);

      assert.strictEqual(dpBroker.workers.length, 0);
    });
  });
});
