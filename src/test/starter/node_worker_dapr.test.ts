import path from 'path';

import * as common from '../common';
import { startAllRoles, testWorker, FIXTURES_DIR, Roles } from '../util';
import { startTurfD, stopTurfD } from '../../lib/turf';
import mm from 'mm';
import { NoslatedClient } from '#self/sdk/index';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '#self/data_plane';
import { config } from '#self/config';

const workersDir = path.join(FIXTURES_DIR, 'starter');

const cases = [
  {
    name: 'node_worker_dapr_invoke_timeout',
    profile: {
      name: 'node_worker_dapr_invoke_timeout',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'timeout.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: '{"error":"Noslated request failed: CanonicalCode::TIMEOUT request kind(DaprInvoke), Request Timeout"}',
    },
  },
  {
    name: 'node_worker_dapr_invoke_failure',
    profile: {
      name: 'node_worker_dapr_invoke_failure',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'failure.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: '{"status":500,"data":"Request rejected"}',
    },
  },
  {
    name: 'node_worker_dapr_binding',
    profile: {
      name: 'node_worker_dapr_binding',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'binding.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: '{"status":200,"data":"say: aworker, age: 10"}',
    },
  },
  {
    name: 'node_worker_dapr_binding_timeout',
    profile: {
      name: 'node_worker_dapr_binding_timeout',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'binding_timeout.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: 'Noslated request failed: CanonicalCode::TIMEOUT request kind(DaprBinding), Request Timeout',
    },
  },
  {
    name: 'node_worker_dapr_binding_failure',
    profile: {
      name: 'node_worker_dapr_binding_failure',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'binding_failure.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: '{"status":500,"data":"Request rejected"}',
    },
  },
];

describe(common.testName(__filename), () => {
  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;

  beforeEach(async () => {
    mm(config.dataPlane, 'daprAdaptorModulePath', require.resolve('./dapr'));

    const roles = await startAllRoles() as Required<Roles>;

    data = roles.data;
    agent = roles.agent;
    control = roles.control;

    await startTurfD();
  });

  afterEach(async () => {
    if (data) {
      await Promise.all([
        data.close(),
        agent.close(),
        control.close(),
      ]);
    }

    await stopTurfD();
  });

  for (const item of cases) {
    it(item.name, async () => {
      await agent.setFunctionProfile([ item.profile ] as any);
      await testWorker(agent!, item);
    });
  }
});
