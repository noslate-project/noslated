import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { ResourceServer } from '#self/test/baseline/resource-server';
import { assertInvokeService } from '#self/test/util';
import mm from 'mm';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  before(async () => {
    resourceServer = new ResourceServer();
    await resourceServer.start();
  });

  after(async () => {
    await resourceServer.close();
  });

  const env = new DefaultEnvironment();

  afterEach(async () => {
    mm.restore();
  });

  it('should reject not found service', async () => {
    await assertInvokeService(env.agent, 'non-exists', {
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        error: {
          message: /Service not found/,
        },
      },
    });
  });

  it('should route to default target', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      },
    ]);
    await env.agent.setServiceProfile([
      {
        name: 'foobar',
        selector: {
          functionName: 'node_worker_echo',
        },
      },
    ] as any);

    await assertInvokeService(env.agent, 'foobar', {
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        data: Buffer.from('foobar'),
      },
    });
  });

  it('should route with proportional balancing', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      },
    ]);
    await env.agent.setServiceProfile([
      {
        name: 'foobar',
        type: 'proportional-load-balance',
        selectors: [
          {
            selector: {
              functionName: 'node_worker_echo',
            },
            proportion: 0.5,
          },
          {
            selector: {
              functionName: 'non-exists',
            },
            proportion: 0.5,
          },
        ],
      },
    ]);

    mm(Math, 'random', () => 0.1);

    await assertInvokeService(env.agent, 'foobar', {
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        data: Buffer.from('foobar'),
      },
    });

    mm(Math, 'random', () => 0.7);

    await assertInvokeService(env.agent, 'foobar', {
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        error: {
          message: /No function named non-exists registered/,
        },
      },
    });
  });
});
