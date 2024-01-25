import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { bufferFromStream, sleep } from '#self/lib/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { ConcurrencyStatsMode } from '#self/lib/json/function_profile';

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

  it('should reset shrink down when resetShrinkCooldownOnRequestActive=true', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo_ema',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          resetShrinkCooldownOnRequestActive: true,
          shrinkCooldown: 5_000,
          concurrencyStatsMode: ConcurrencyStatsMode.PERIODIC_AVG,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    const statManager = env.control._ctx.getInstance('stateManager');

    await request('aworker_echo_ema', env);

    await sleep(1000);

    await request('aworker_echo_ema', env);

    await sleep(5000);

    const brokerBefore = statManager.getBroker('aworker_echo_ema', false);

    assert(brokerBefore?.workerCount === 1);

    await sleep(5000);

    const brokerAfter = statManager.getBroker('aworker_echo_ema', false);
    assert(brokerAfter == null);
  });

  it('should reset shrink down when resetShrinkCooldownOnRequestActive=true and shrinkCooldownOnStartup=false', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo_ema',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          resetShrinkCooldownOnRequestActive: true,
          shrinkCooldownOnStartup: false,
          shrinkCooldown: 5_000,
          concurrencyStatsMode: ConcurrencyStatsMode.PERIODIC_AVG,
        },
        resourceLimit: {
          memory: 200 * 1024 * 1024,
        },
      },
    ]);

    const statManager = env.control._ctx.getInstance('stateManager');

    await request('aworker_echo_ema', env);

    await sleep(1000);

    await request('aworker_echo_ema', env);

    await sleep(5000);

    const brokerBefore = statManager.getBroker('aworker_echo_ema', false);

    assert(brokerBefore?.workerCount === 1);

    await sleep(5000);

    const brokerAfter = statManager.getBroker('aworker_echo_ema', false);
    assert(brokerAfter == null);
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
