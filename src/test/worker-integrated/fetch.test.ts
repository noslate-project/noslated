import assert from 'assert';

import { testWorker, FIXTURES_DIR } from '../util';
import * as common from '#self/test/common';

import { ResourceServer } from '../baseline/resource-server';
import { killWorker } from './util';
import { once } from 'events';
import path from 'path';
import { DefaultEnvironment } from '../env/environment';

const codeDir = path.join(FIXTURES_DIR, 'worker-integrated');

class TestEnvironment extends DefaultEnvironment {
  resourceServer!: ResourceServer;

  async before(ctx: Mocha.Context) {
    super.before(ctx);
    this.resourceServer = new ResourceServer();
    await this.resourceServer.start();
  }

  async after(ctx: Mocha.Context) {
    super.after(ctx);
    await this.resourceServer.close();
  }

}

const cases: any = [
  {
    name: 'fetch_exit-without-ending',
    profile: {
      name: 'fetch_exit-without-ending',
      runtime: 'aworker',
      url: `file://${codeDir}/fetch`,
      sourceFile: 'exit-without-ending.js',
      signature: 'md5:234234',
    },
    input: {},
    expect: {},
    after: async (env: TestEnvironment, item: any) => {
      assert.strictEqual(env.resourceServer.zombieRequestCount, 1);
      await killWorker(env.control, item.name);
      await once(env.resourceServer, 'req-close');
      assert.strictEqual(env.resourceServer.zombieRequestCount, 0);
    },
  },
];

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new TestEnvironment();

  for (const item of cases) {
    const _it = (item.seed && process.platform === 'darwin') ? it.skip : it;
    _it(item.name, async () => {
      if (item.before) {
        await item.before(env, item);
      }

      await env.agent.setFunctionProfile([ item.profile ]);
      await testWorker(env.agent, item);
      if (item.after) {
        await item.after(env, item);
      }
    });
  }
});
