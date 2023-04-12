import * as common from '#self/test/common';
import { testWorker } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);
  const env = new DefaultEnvironment();

  it('take streaming request into concurrency count', async () => {
    const profile: AworkerFunctionProfile = {
      name: 'stream_concurrency',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_stream`,
      sourceFile: 'concurrency.js',
      signature: 'md5:234234',
      worker: {
        replicaCountLimit: 1,
        fastFailRequestsOnStarting: false,
        maxActivateRequests: 1,
      },
    };

    await env.agent.setFunctionProfile([profile]);

    function req() {
      return testWorker(env.agent, {
        profile,
        input: {
          data: Buffer.from(''),
        },
        expect: {
          status: 200,
          data: Buffer.from('foobar'),
        },
      });
    }

    await Promise.all([req(), req()]);
  });
});
