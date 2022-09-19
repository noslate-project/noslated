import assert from 'assert';
import { testName, baselineDir } from '#self/test/common';
import { daemonProse, ProseContext } from '#self/test/util';
import { Guest } from '#self/lib/rpc/guest';
import { descriptor } from '#self/lib/rpc/util';

describe(testName(__filename), () => {
  const roles: ProseContext<{}> = {};
  let guest: Guest;

  daemonProse(roles);

  beforeEach(async () => {
    guest = new Guest(roles.control!.herald.address);
    guest.addService((descriptor as any).alice.control.ControlPlane);
    await guest.start();
  });
  afterEach(async () => {
    await guest.close();
  });

  describe('getFunctionProfile', () => {
    it('should inspect current function profiles', async () => {
      const expectedProfile = {
        name: 'node_worker_echo',
        runtime: 'nodejs-v16' as const,
        url: `file://${baselineDir}/node_worker_echo`,
        handler: 'index.handler',
        signature: 'md5:234234',
      };
      await roles.agent!.setFunctionProfile([
        expectedProfile,
      ]);

      const ret = await (guest as any).getFunctionProfile({});
      assert.strictEqual(ret.profiles.length, 1);
      const [ actualProfile ] = ret.profiles;
      assert.deepStrictEqual(actualProfile, expectedProfile);
    });
  });
});
