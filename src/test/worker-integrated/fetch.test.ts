import assert from 'assert';
import mm from 'mm';

import { startTurfD, stopTurfD } from '#self/lib/turf';
import { testWorker, startAllRoles, FIXTURES_DIR, Roles } from '../util';
import * as common from '#self/test/common';

import { ResourceServer } from '../baseline/resource-server';
import { killWorker } from './util';
import { once } from 'events';
import path from 'path';
import { NoslatedClient } from '#self/sdk/index';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '#self/data_plane';

const codeDir = path.join(FIXTURES_DIR, 'worker-integrated');

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
    after: async ({ item, control, resourceServer }: { item: any; control: any; resourceServer: any}) => {
      assert.strictEqual(resourceServer.zombieRequestCount, 1);
      await killWorker(control, item.name);
      await once(resourceServer, 'req-close');
      assert.strictEqual(resourceServer.zombieRequestCount, 0);
    },
  },
];

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;
  before(async () => {
    resourceServer = new ResourceServer();
    await resourceServer.start();
  });

  after(async () => {
    await resourceServer.close();
  });

  beforeEach(async () => {
    startTurfD();
    const roles = await startAllRoles() as Required<Roles>;
    data = roles.data;
    agent = roles.agent;
    control = roles.control;
    await control.turf.destroyAll();
  });

  afterEach(async () => {
    mm.restore();
    if (data) {
      await Promise.all([
        data.close(),
        agent.close(),
        control.close(),
      ]);
    }

    stopTurfD();
  });

  for (const item of cases) {
    const _it = (item.seed && process.platform === 'darwin') ? it.skip : it;
    _it(item.name, async () => {
      if (item.before) {
        await item.before({ item, agent, control, data, turf: control.turf, resourceServer });
      }

      await agent.setFunctionProfile([ item.profile ]);
      await testWorker(agent!, item);
      if (item.after) {
        await item.after({ item, agent, control, data, turf: control.turf, resourceServer });
      }
    });
  }
});
