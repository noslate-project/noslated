import { once } from 'events';
import assert from 'assert';

import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { assertInvoke } from '#self/test/util';
import { Guest } from '#self/lib/rpc/guest';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let guest: Guest;
  const env = new DefaultEnvironment();

  beforeEach(async () => {
    guest = new Guest(env.data.host.address);
    await guest.start();
  });
  afterEach(async () => {
    await guest.close();
  });

  it('should broadcast worker stats', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'node_worker_echo',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      },
    ]);
    guest.subscribe('workerTrafficStats');

    {
      const future = once(guest, 'workerTrafficStats');
      const [msg] = await future;
      // no workers yet.
      assert.strictEqual(msg.brokers.length, 0);
    }

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

    {
      const future = once(guest, 'workerTrafficStats');
      const [msg] = await future;
      assert.strictEqual(msg.brokers.length, 1);
      const [broker] = msg.brokers;
      assert.strictEqual(broker.functionName, 'node_worker_echo');
      assert.strictEqual(broker.workers.length, 1);
    }
  });
});
