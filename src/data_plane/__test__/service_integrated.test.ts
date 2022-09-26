import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { ResourceServer } from '#self/test/baseline/resource-server';
import { startTurfD, stopTurfD } from '#self/lib/turf';
import { assertInvokeService, Roles, startAllRoles } from '#self/test/util';
import mm from 'mm';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '../data_plane';
import { AliceAgent } from '#self/sdk/index';

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  let agent: AliceAgent;
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
    await startTurfD();
    const roles = await startAllRoles() as Required<Roles>;
    data = roles.data;
    agent = roles.agent;
    control = roles.control;
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

    await stopTurfD();
  });

  it('should reject not found service', async () => {
    await assertInvokeService(agent, 'non-exists', {
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
    await agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs-v16',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      },
    ]);
    await agent.setServiceProfile([
      {
        name: 'foobar',
        selector: {
          functionName: 'node_worker_echo',
        },
      },
    ] as any);

    await assertInvokeService(agent, 'foobar', {
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
    await agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs-v16',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      },
    ]);
    await agent.setServiceProfile([
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

    await assertInvokeService(agent, 'foobar', {
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

    await assertInvokeService(agent, 'foobar', {
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
