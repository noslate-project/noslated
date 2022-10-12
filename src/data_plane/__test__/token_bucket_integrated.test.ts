import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { startTurfD, stopTurfD } from '#self/lib/turf';
import { assertInvoke, Roles, startAllRoles } from '#self/test/util';
import FakeTimer, { Clock } from '@sinonjs/fake-timers';
import mm from 'mm';
import { AliceAgent } from '#self/sdk/index';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '../data_plane';

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let agent: AliceAgent;
  let control: ControlPlane;
  let data: DataPlane;
  /** @type {FakeTimer.Clock} */
  let clock: Clock;

  beforeEach(async () => {
    await startTurfD();
    const roles = await startAllRoles() as Required<Roles>;
    data = roles.data;
    agent = roles.agent;
    control = roles.control;
    clock = FakeTimer.install({
      toFake: ['setInterval'],
    });
  });

  afterEach(async () => {
    clock.uninstall();
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

  it('should route to default target', async () => {
    await agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
        rateLimit: {
          maxTokenCount: 1,
          tokensPerFill: 1,
          fillInterval: 10_000,
        },
      },
    ]);

    await assertInvoke(agent, 'node_worker_echo', {
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

    await assertInvoke(agent, 'node_worker_echo', {
      input: {
        data: Buffer.from('foobar'),
        metadata: {
          method: 'POST',
        },
      },
      expect: {
        error: /rate limit exceeded/,
      },
    });

    clock.tick(10_000);

    await assertInvoke(agent, 'node_worker_echo', {
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

  it('should route to default target when rateLimit is empty', async () => {
    await agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
        rateLimit: {},
      },
    ]);

    await assertInvoke(agent, 'node_worker_echo', {
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

    await assertInvoke(agent, 'node_worker_echo', {
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
});
