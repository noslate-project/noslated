import * as common from '#self/test/common';
import { DefaultEnvironment } from '#self/test/env/environment';
import assert from 'assert';
import sinon from 'sinon';
import { PrefixedLogger } from '#self/lib/loggers';
import { sleep } from '#self/lib/util';

describe(common.testName(__filename), () => {
  const env = new DefaultEnvironment({
    config: common.extendDefaultConfig({
      controlPlane: {
        dumpWorkerTrafficStats: true,
        workerTrafficStatsPullingMs: 1000,
      },
    }),
  });

  it('should dump worker traffic stats', async () => {
    const stateManager = env.control._ctx.getInstance('stateManager');

    assert(stateManager['_dumpLogger'] instanceof PrefixedLogger);

    const spy = sinon.spy(stateManager['_dumpLogger'], 'info');

    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 1,
          reservationCount: 1,
        },
      },
    ]);

    await sleep(1100);

    assert(
      spy.calledWithMatch(
        'sync broker %s concurrency %d.',
        'aworker_echo:noinspector',
        0
      )
    );
  });
});
