import * as common from '#self/test/common';
import { testWorker } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);
  const env = new DefaultEnvironment({
    config: common.extendDefaultConfig({
      dataPlane: {
        daprAdaptorModulePath: common.daprAdaptorDir,
        daprAdaptorModuleOptions: {
          encoding: 'base64',
        },
      },
    }),
  });

  it('should dapr adaptor options work', async () => {
    const profile: AworkerFunctionProfile = {
      name: 'aworker_dapr_binding',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'binding.js',
      signature: 'md5:234234',
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
          data: Buffer.from(
            JSON.stringify({
              name: 'key-value',
              metadata: {
                foo: JSON.stringify({
                  bar: 'bar',
                }),
              },
              operation: 'get',
              data: 'Zm9vYmFy',
            })
          ),
        },
      });
    }

    await req();
  });
});
