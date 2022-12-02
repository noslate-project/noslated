import path from 'path';

import * as common from '../common';
import { testWorker, FIXTURES_DIR } from '../util';
import mm from 'mm';
import { config } from '#self/config';
import { DefaultEnvironment } from '../env/environment';

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
] as const;

describe(common.testName(__filename), () => {
  beforeEach(async () => {
    mm(config.dataPlane, 'daprAdaptorModulePath', require.resolve('./dapr'));
  });

  afterEach(async () => {
    mm.restore();
  });

  const env = new DefaultEnvironment();

  for (const item of cases) {
    it(item.name, async () => {
      await env.agent.setFunctionProfile([ item.profile ]);
      await testWorker(env.agent, item);
    });
  }
});
