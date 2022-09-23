import path from 'path';

import * as common from '../common';
import { startAllRoles, testWorker, FIXTURES_DIR, Roles } from '../util';
import { startTurfD, stopTurfD } from '../../lib/turf';
import { AliceAgent } from '#self/sdk/index';
import { ControlPanel } from '#self/control_panel';
import { DataPanel } from '#self/data_panel';

const workersDir = path.join(FIXTURES_DIR, 'starter');

const cases = [
  {
    name: 'node_worker_dapr_invoke_timeout',
    profile: {
      name: 'node_worker_dapr_invoke_timeout',
      runtime: 'nodejs-v16',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'timeout.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: '{"error":"Alice request failed: CanonicalCode::TIMEOUT request kind(DaprInvoke), Request Timeout"}',
    },
  },
  {
    name: 'node_worker_dapr_invoke_failure',
    profile: {
      name: 'node_worker_dapr_invoke_failure',
      runtime: 'nodejs-v16',
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
      runtime: 'nodejs-v16',
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
      runtime: 'nodejs-v16',
      url: `file://${workersDir}/node_worker_dapr`,
      handler: 'binding_timeout.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      data: 'Alice request failed: CanonicalCode::TIMEOUT request kind(DaprBinding), Request Timeout',
    },
  },
  {
    name: 'node_worker_dapr_binding_failure',
    profile: {
      name: 'node_worker_dapr_binding_failure',
      runtime: 'nodejs-v16',
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
  let agent: AliceAgent;
  let control: ControlPanel;
  let data: DataPanel;

  beforeEach(async () => {
    const roles = await startAllRoles() as Required<Roles>;

    data = roles.data;
    agent = roles.agent;
    control = roles.control;

    await agent.setDaprAdaptor(require.resolve('./dapr'));

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
