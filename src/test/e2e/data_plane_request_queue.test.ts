import * as common from '#self/test/common';
import { testWorker } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { NodejsFunctionProfile } from '#self/lib/json/function_profile';
import { sleep } from '#self/lib/util';
import { TurfContainerStates } from '#self/lib/turf';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);
  const env = new DefaultEnvironment();

  it('should reject request when request queue is disabled', async () => {
    const profile: NodejsFunctionProfile = {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        disableRequestQueue: true,
      },
    };

    await env.agent.setFunctionProfile([profile]);

    await testWorker(env.agent, {
      profile,
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        error: {
          message: /No available worker process for node_worker_echo now\./,
        },
      },
    });

    // TODO: refactor with events.
    // 虽然在启动阶段检验要 fastfail，但是仍然要在测试之后检测在 fastfail 之后，Worker 进程是否仍然被
    // 正常启动，所以用一个 loop 去轮询，直至 worker 正常为止。
    // 若不正常，则触发 mocha 超时，导致失败。
    do {
      await sleep(10);
      const workers = Array.from(
        env.data.dataFlowController.getBroker('node_worker_echo')!.workers()
      );
      if (workers.length === 0) continue;
      const worker = workers[0];
      const ps = await env.turf.ps();
      for (const p of ps) {
        if (p.status === TurfContainerStates.running && p.name === worker.name)
          return;
      }
    } while (true);
  });
});
