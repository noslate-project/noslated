import assert from 'assert';
import mm from 'mm';
import { NoslatedClient } from '#self/sdk/index';
import { testName, baselineDir, daprAdaptorDir } from '#self/test/common';
import { config } from '#self/config';
import { ControlPlane } from '#self/control_plane/index';
import { ControlPlaneClientManager } from '#self/sdk/control_plane_client_manager';
import { DataPlaneClientManager } from '#self/sdk/data_plane_client_manager';
import { DataPlaneClientManager as _DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager' ;
import { Guest } from '#self/lib/rpc/guest';
import { mockClientCreatorForManager } from '#self/test/util';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { DataPlane } from '#self/data_plane/index';
import { startTurfD, stopTurfD } from '#self/lib/turf';

describe(testName(__filename), () => {
  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;

  beforeEach(async () => {
    startTurfD();
    agent = new NoslatedClient();
  });

  afterEach(async () => {
    mm.restore();
    await agent.close();
    await control?.close();
    await data?.close();
    stopTurfD();
  });

  describe('.setFunctionProfile()', () => {
    it('should not set profile due to invalid v8 options (service worker)', async () => {
      const profile: any = {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          v8Options: [
            '--hello',
          ],
        },
      };

      control = new ControlPlane(config);
      const checkV8Options = control.herald.impl.checkV8Options;
      let errMessage = '';
      mm(control.herald.impl, 'checkV8Options', function(this: ControlPlane,profiles: RawFunctionProfile[]) {
        try {
          checkV8Options.call(this, profiles);
        } catch (e) {
          errMessage = (e as Error).message;
          throw e;
        }
      });
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      await assert.rejects(() => agent.setFunctionProfile([ profile ]), /Function profile didn't set\./);
      assert.match(errMessage, /Additional v8Options array includes an invalid v8 option --hello./);
    });

    it('should not set profile due to invalid v8 options (nodejs)', async () => {
      const profile: any = {
        name: 'node_worker_v8_options',
        runtime: 'nodejs',
        url: `file://${baselineDir}/node_worker_v8_options`,
        handler: 'index.handler',
        signature: 'md5:234234',
        worker: {
          v8Options: [
            '--hello',
          ],
        },
      };

      control = new ControlPlane(config);
      const checkV8Options = control.herald.impl.checkV8Options;
      let errMessage = '';
      mm(control.herald.impl, 'checkV8Options', function(this: ControlPlane, profiles: RawFunctionProfile[]) {
        try {
          checkV8Options.call(this, profiles);
        } catch (e) {
          errMessage = (e as Error).message;
          throw e;
        }
      });
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      await assert.rejects(() => agent.setFunctionProfile([ profile ]), /Function profile didn't set\./);
      assert.match(errMessage, /Additional v8Options array includes an invalid v8 option --hello./);
    });
  });

  describe('.setPlatformEnvironmentVariables()', () => {
    const envs: any = [{
      key: 'foo',
      value: 'bar',
    }];

    it('should set platform environment variables even if no client connected', async () => {
      mockClientCreatorForManager(ControlPlaneClientManager);
      mockClientCreatorForManager(DataPlaneClientManager);
      await agent.start();
      agent.controlPlaneClientManager.clients()[0].emit(Guest.events.CONNECTIVITY_STATE_CHANGED, Guest.connectivityState.CONNECTING);
      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);
    });

    it('should set platform environment variables', async () => {
      control = new ControlPlane(config);
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      assert.deepStrictEqual(control.platformEnvironmentVariables, {});

      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);

      assert.deepStrictEqual(control.platformEnvironmentVariables, { foo: 'bar' });
    });

    it('should throw error if not string', async () => {
      control = new ControlPlane(config);
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      assert.deepStrictEqual(control.platformEnvironmentVariables, {});

      await assert.rejects(agent.setPlatformEnvironmentVariables([ ...envs, { key: '你瞅啥', value: 1000 }]), {
        message: /Platform environment variables' value can't be out of string. \(Failed: 你瞅啥, 1000 \(number\)\)/,
      });

      assert.deepStrictEqual(agent.platformEnvironmentVariables, []);
      assert.deepStrictEqual(control.platformEnvironmentVariables, {});
    });

    it('should throw error if reserved key hits', async () => {
      control = new ControlPlane(config);
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      assert.deepStrictEqual(control.platformEnvironmentVariables, {});

      await assert.rejects(agent.setPlatformEnvironmentVariables([ ...envs, { key: 'NOSLATED_你瞅啥', value: '瞅你咋地' }]), {
        message: /Platform environment variables' key can't start with NOSLATED_ and NOSLATE_. \(Failed: NOSLATED_你瞅啥\)/,
      });

      assert.deepStrictEqual(agent.platformEnvironmentVariables, []);
      assert.deepStrictEqual(control.platformEnvironmentVariables, {});
    });
  });
});
