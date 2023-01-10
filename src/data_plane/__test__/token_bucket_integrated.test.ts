import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { assertInvoke } from '#self/test/util';
import FakeTimer, { Clock } from '@sinonjs/fake-timers';
import mm from 'mm';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let clock: Clock;

  const env = new DefaultEnvironment();

  beforeEach(async () => {
    clock = FakeTimer.install({
      toFake: ['setInterval'],
    });
  });

  afterEach(async () => {
    clock.uninstall();
    mm.restore();
  });

  it('should route to default target', async () => {
    await env.agent.setFunctionProfile([
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

    await assertInvoke(env.agent, 'node_worker_echo', {
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

    await assertInvoke(env.agent, 'node_worker_echo', {
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

    await assertInvoke(env.agent, 'node_worker_echo', {
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
    await env.agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
        rateLimit: {},
      },
    ]);

    await assertInvoke(env.agent, 'node_worker_echo', {
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

    await assertInvoke(env.agent, 'node_worker_echo', {
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
