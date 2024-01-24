import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { bufferFromStream, sleep } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';

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

  it('first shrink should work on request finish', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo_ema',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          shrinkCooldownOnStartup: false,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    const statManager = env.control._ctx.getInstance('stateManager');

    await request('aworker_echo_ema', env);

    const brokerBefore = statManager.getBroker('aworker_echo_ema', false);

    assert(brokerBefore?.workerCount === 1);

    await sleep(10000);

    const brokerAfter = statManager.getBroker('aworker_echo_ema', false);
    assert(brokerAfter == null);
  });

  it('first shrink should cooldown on request finish when shrinkCooldownOnStartup=true', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo_ema',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          shrinkCooldownOnStartup: true,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    const statManager = env.control._ctx.getInstance('stateManager');

    await request('aworker_echo_ema', env);

    const brokerBefore = statManager.getBroker('aworker_echo_ema', false);

    assert(brokerBefore?.workerCount === 1);

    await sleep(10000);

    const brokerAfter = statManager.getBroker('aworker_echo_ema', false);
    assert(brokerAfter?.workerCount === 1);
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
