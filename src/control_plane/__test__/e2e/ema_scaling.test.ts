import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { bufferFromStream, sleep } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';

/**
 * 仅观测行为
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
      systemCircuitBreaker: {
        // 部分 CI 环境性能较差，防止触发 breaker
        systemLoad1Limit: 30,
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

    const sequence = [1, 1, 1, 10, 1, 6, 5, 0, 0, 0];

    for (const concurrency of sequence) {
      await makeConcurrencyRequest('aworker_echo_ema', concurrency, env);
      await sleep(1000);
    }

    await sleep(1000);
  });
});

async function request(functionName: string, env: DefaultEnvironment) {
  const data = Buffer.from('200');

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

const WEIGHTS = {
  0: 10,
  1: 10,
  2: 8,
  3: 8,
  4: 7,
  5: 6,
  6: 5,
  7: 4,
  8: 3,
  9: 2,
  10: 1,
};

function generateWeightedSequence(
  length: number,
  weights: Record<number, number>
): number[] {
  const sequence = [];
  const weightedValues = [];

  // 构造根据权重扩展的值数组
  for (const [value, weight] of Object.entries(weights)) {
    for (let i = 0; i < weight; i++) {
      weightedValues.push(parseInt(value));
    }
  }

  // 生成序列
  while (sequence.length < length) {
    const randomIndex = Math.floor(Math.random() * weightedValues.length);
    sequence.push(weightedValues[randomIndex]);
  }

  return sequence;
}
