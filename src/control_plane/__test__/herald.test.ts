import assert from 'assert';
import { testName, baselineDir } from '#self/test/common';
import { Guest } from '#self/lib/rpc/guest';
import { descriptor } from '#self/lib/rpc/util';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(testName(__filename), () => {
  let guest: Guest;

  const env = new DefaultEnvironment();
  beforeEach(async () => {
    guest = new Guest(env.control._ctx.getInstance('herald').address);
    guest.addService((descriptor as any).noslated.control.ControlPlane);
    await guest.start();
  });
  afterEach(async () => {
    await guest.close();
  });

  describe('getFunctionProfile', () => {
    it('should inspect current function profiles', async () => {
      const expectedProfile = {
        name: 'node_worker_echo',
        runtime: 'nodejs' as const,
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      };
      await env.agent.setFunctionProfile([expectedProfile]);

      const ret = await (guest as any).getFunctionProfile({});
      assert.strictEqual(ret.profiles.length, 1);
      const [actualProfile] = ret.profiles;
      assert.deepStrictEqual(actualProfile, expectedProfile);
    });
  });
});
