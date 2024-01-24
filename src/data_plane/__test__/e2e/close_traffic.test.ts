import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { bufferFromStream, sleep } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(60_000);

  const env = new DefaultEnvironment({
    config: common.extendDefaultConfig({
      controlPlane: {
        useEmaScaling: true,
        dumpWorkerTrafficStats: true,
      },
      dataPlane: {
        closeTrafficTimeout: 2000,
      },
    }),
  });

  it('should close worker', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_stream',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_stream`,
        sourceFile: 'stream_with_delay.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          disposable: true,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    await request('aworker_stream', env);

    await sleep(1000);

    const broker = env.data.dataFlowController.brokers.get(
      'aworker_stream$$noinspect'
    );

    assert.strictEqual(broker?.workerCount, 0);
  });

  it('should close worker with timeout', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_stream_delay',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_stream`,
        sourceFile: 'stream_with_delay.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          concurrencyShrinkThreshold: 0.6,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    request('aworker_stream_delay', env, 30000).catch(error => {
      assert(error);
      assert(error.message.includes('Peer connection closed'));
    });

    await sleep(1000);

    let broker = env.data.dataFlowController.brokers.get(
      'aworker_stream_delay$$noinspect'
    );

    const worker = Array.from(
      broker?.['_workerMap'].values() || []
    ).pop() as any;

    env.data.dataFlowController.closeTraffic([
      {
        functionName: 'aworker_stream_delay',
        inspector: false,
        workers: [
          {
            credential: worker!.worker!.credential,
          },
        ],
      },
    ]);

    await sleep(3000);

    broker = env.data.dataFlowController.brokers.get(
      'aworker_stream_delay$$noinspect'
    );

    assert.strictEqual(broker?.workerCount, 0);
  });
});

async function request(
  functionName: string,
  env: DefaultEnvironment,
  timeout = 0
) {
  const data = Buffer.from(timeout + '');

  const response = await env.agent.invoke(functionName, data, {
    method: 'POST',
    timeout: 30000,
  });

  assert.strictEqual(response.status, 200);

  return await bufferFromStream(response);
}
