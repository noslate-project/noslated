import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { bufferFromStream, sleep } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';

/**
 * 仅观测行为
 * 在内部 ci 时因配置问题，容易触发 load 系统保护
 */
describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new DefaultEnvironment({
    createTestClock: true,
    config: common.extendDefaultConfig({
      virtualMemoryPoolSize: '4gb',
      controlPlane: {
        useEmaScaling: true,
        workerTrafficStatsPullingMs: 1000,
      },
    }),
  });

  it('should scaling smooth when traffic change', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo_ema',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'sleep.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          replicaCountLimit: 15,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    const sequence = [1, 1, 1, 5, 1, 0, 0, 0];

    for (const concurrency of sequence) {
      await makeConcurrencyRequest('aworker_echo_ema', concurrency, env);
      await sleep(1000);
    }

    await sleep(1000);
  });
});

async function request(functionName: string, env: DefaultEnvironment) {
  const data = Buffer.from('100');

  const response = await env.agent.invoke(functionName, data, {
    method: 'POST',
  });

  assert.strictEqual(response.status, 200);

  return await bufferFromStream(response);
}

function makeConcurrencyRequest(
  functionName: string,
  concurrency: number,
  env: DefaultEnvironment
) {
  const requests = new Array(concurrency).fill(0).map(() => {
    return request(functionName, env);
  });

  return Promise.all(requests);
}
