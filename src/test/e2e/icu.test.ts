import * as common from '#self/test/common';
import { spawn } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import assert from 'assert';

const invokePath = require.resolve('#self/lib/icu/invoke');

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);
  const env = new DefaultEnvironment();

  let cleanup: () => unknown;
  afterEach(async () => {
    cleanup?.();
  });

  it('icu should resolve sock addr from service', async () => {
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

    const { stdout } = await spawn(
      process.execPath,
      [
        invokePath,
        '--service',
        'noslated.control.ControlPlane',
        'getFunctionProfile',
        '{}',
      ],
      {
        env: {
          ...process.env,
          GRPC_TRACE: '',
          GRPC_VERBOSITY: 'NONE',
        },
      }
    );
    const { profiles } = JSON.parse(stdout);
    assert.ok(Array.isArray(profiles));
    assert.strictEqual(profiles.length, 1);
  });
});
