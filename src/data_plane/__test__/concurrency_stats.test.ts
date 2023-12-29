import { bufferFromStream, sleep } from '#self/lib/util';
import * as common from '#self/test/common';
import { DefaultEnvironment } from '#self/test/env/environment';
import sinon from 'sinon';
import assert from 'assert';
import { Metadata } from '#self/delegate/request_response';
import { TriggerErrorStatus } from '../request_logger';
import { Broker } from '#self/control_plane/worker_stats/broker';
import { ConcurrencyStatsMode } from '#self/lib/json/function_profile';
import { assertCloseTo } from '#self/test/util';

const { baselineDir } = common;

describe(common.testName(__filename), function () {
  this.timeout(60_000);

  const env = new DefaultEnvironment();

  it('should instant concurrency stats work as legacy mode', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'sleep.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
        },
      },
    ]);

    request(env, 500);
    request(env, 500);

    await sleep(100);

    const dataFlowController = env.data.dataFlowController;
    const broker = dataFlowController.brokers.get('aworker_echo$$noinspect');

    assert.strictEqual(broker?.toJSON().concurrency, 2);

    await sleep(1000);

    assert.strictEqual(broker?.toJSON().concurrency, 0);
  });

  it('should periodic_max concurrency stats work', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'sleep.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          concurrencyStatsMode: ConcurrencyStatsMode.PERIODIC_MAX,
        },
      },
    ]);

    request(env, 500);
    request(env, 500);

    await sleep(100);

    const dataFlowController = env.data.dataFlowController;
    const broker = dataFlowController.brokers.get('aworker_echo$$noinspect');

    await sleep(1000);

    assert.strictEqual(broker?.toJSON().concurrency, 2);
  });

  it('should periodic_avg concurrency stats work', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'sleep.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          concurrencyStatsMode: ConcurrencyStatsMode.PERIODIC_AVG,
        },
      },
    ]);

    request(env, 500);
    request(env, 500);

    await sleep(1000);

    const dataFlowController = env.data.dataFlowController;
    const broker = dataFlowController.brokers.get('aworker_echo$$noinspect');

    assertCloseTo(broker?.toJSON().concurrency!, 1, 0.1);
  });
});

async function request(env: DefaultEnvironment, timeout: number) {
  const response = await env.agent.invoke(
    'aworker_echo',
    Buffer.from('' + timeout),
    {
      method: 'POST',
    }
  );

  await bufferFromStream(response);
}
