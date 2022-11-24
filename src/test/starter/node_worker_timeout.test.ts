import path from 'path';

import * as common from '../common';
import { startAllRoles, testWorker, FIXTURES_DIR, Roles } from '../util';
import { startTurfD, stopTurfD } from '../../lib/turf';
import { NoslatedClient } from '#self/sdk/index';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '#self/data_plane';

const workersDir = path.join(FIXTURES_DIR, 'starter');

const cases = [
  {
    name: 'node_worker_timeout_no_metadata',
    profile: {
      name: 'node_worker_timeout_no_metadata',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_timeout`,
      handler: 'no_metadata.handler',
      signature: 'md5:234234',
    },
    input: {
      metadata: {
        method: 'GET',
        timeout: 1000,
      },
    },
    expect: {
      error: {
        message: /CanonicalCode::TIMEOUT/,
        operation: /Trigger/,
      },
    },
  },
];

describe(common.testName(__filename), () => {
  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;

  beforeEach(async () => {
    startTurfD();

    const roles = await startAllRoles() as Required<Roles>;

    data = roles.data;
    agent = roles.agent;
    control = roles.control;
  });

  afterEach(async () => {
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
    it(item.name, async () => {
      await agent.setFunctionProfile([ item.profile ] as any);
      await testWorker(agent!, item);
    });
  }
});
