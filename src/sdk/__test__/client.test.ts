import assert from 'assert';
import mm from 'mm';
import { NoslatedClient } from '#self/sdk/index';
import { testName } from '#self/test/common';
import { ControlPlane } from '#self/control_plane/index';
import { ControlPlaneClientManager } from '#self/sdk/control_plane_client_manager';
import { DataPlaneClientManager } from '#self/sdk/data_plane_client_manager';
import { DataPlaneClientManager as _DataPlaneClientManager } from '#self/control_plane/data_plane_client/manager';
import { Guest } from '#self/lib/rpc/guest';
import { mockClientCreatorForManager } from '#self/test/util';
import { DataPlane } from '#self/data_plane/index';
import { startTurfD, stopTurfD } from '#self/test/turf';
import sinon from 'sinon';
import { PlatformEnvironsUpdatedEvent } from '#self/control_plane/events';

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

  describe('.setPlatformEnvironmentVariables()', () => {
    const envs: any = [
      {
        key: 'foo',
        value: 'bar',
      },
    ];

    it('should set platform environment variables even if no client connected', async () => {
      mockClientCreatorForManager(ControlPlaneClientManager);
      mockClientCreatorForManager(DataPlaneClientManager);
      await agent.start();
      agent.controlPlaneClientManager
        .clients()[0]
        .emit(
          Guest.events.CONNECTIVITY_STATE_CHANGED,
          Guest.connectivityState.CONNECTING
        );
      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);
    });

    it('should publish platform environment variables updated events', async () => {
      control = new ControlPlane();
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      const stub = sinon.stub();
      const eventBus = control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: stub,
      });

      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);

      assert.strictEqual(stub.callCount, 1);
      assert.deepStrictEqual(stub.args[0][0].data, {
        foo: 'bar',
      });
    });

    it('should throw error if not string', async () => {
      control = new ControlPlane();
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      const stub = sinon.stub();
      const eventBus = control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: stub,
      });

      await assert.rejects(
        agent.setPlatformEnvironmentVariables([
          ...envs,
          { key: '你瞅啥', value: 1000 },
        ]),
        {
          message:
            /Platform environment variables' value can't be out of string. \(Failed: 你瞅啥, 1000 \(number\)\)/,
        }
      );

      assert.deepStrictEqual(agent.platformEnvironmentVariables, []);
      assert.strictEqual(stub.callCount, 0);
    });

    it('should throw error if reserved key hits', async () => {
      control = new ControlPlane();
      mockClientCreatorForManager(DataPlaneClientManager);
      mockClientCreatorForManager(_DataPlaneClientManager);
      await control.ready();
      await agent.start();

      const stub = sinon.stub();
      const eventBus = control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: stub,
      });

      await assert.rejects(
        agent.setPlatformEnvironmentVariables([
          ...envs,
          { key: 'NOSLATED_你瞅啥', value: '瞅你咋地' },
        ]),
        {
          message:
            /Platform environment variables' key can't start with NOSLATED_ and NOSLATE_. \(Failed: NOSLATED_你瞅啥\)/,
        }
      );

      assert.deepStrictEqual(agent.platformEnvironmentVariables, []);
      assert.strictEqual(stub.callCount, 0);
    });
  });
});
