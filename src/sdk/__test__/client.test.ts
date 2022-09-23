import assert from 'assert';
import mm from 'mm';
import { AliceAgent } from '#self/sdk/index';
import { testName, baselineDir, daprAdaptorDir } from '#self/test/common';
import { config } from '#self/config';
import { ControlPanel } from '#self/control_panel/index';
import { ControlPanelClientManager } from '#self/sdk/control_panel_client_manager';
import { DataPanelClientManager } from '#self/sdk/data_panel_client_manager';
import { DataPanelClientManager as _DataPanelClientManager } from '#self/control_panel/data_panel_client/manager' ;
import { Guest } from '#self/lib/rpc/guest';
import { mockClientCreatorForManager } from '#self/test/util';
import { RawFunctionProfile } from '#self/lib/json/function_profile';
import { DataPanel } from '#self/data_panel/index';
import sinon from 'sinon';
import { sleep } from '#self/lib/util';
import _ from 'lodash';

describe(testName(__filename), () => {
  let agent: AliceAgent;
  let control: ControlPanel;
  let data: DataPanel;

  beforeEach(async () => {
    agent = new AliceAgent();
  });

  afterEach(async () => {
    mm.restore();
    await agent.close();
    await control?.close();
    await data?.close();
  });

  describe('.setFunctionProfile()', () => {
    it('should not set profile due to invalid v8 options (service worker)', async () => {
      const profile: any = {
        name: 'service_worker_echo',
        runtime: 'aworker',
        url: `file://${baselineDir}/service_worker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          v8Options: [
            '--hello',
          ],
        },
      };

      control = new ControlPanel(config);
      const checkV8Options = control.herald.impl.checkV8Options;
      let errMessage = '';
      mm(control.herald.impl, 'checkV8Options', function(this: ControlPanel,profiles: RawFunctionProfile[]) {
        try {
          checkV8Options.call(this, profiles);
        } catch (e) {
          errMessage = (e as Error).message;
          throw e;
        }
      });
      mockClientCreatorForManager(DataPanelClientManager);
      mockClientCreatorForManager(_DataPanelClientManager);
      await control.ready();
      await agent.start();

      await assert.rejects(() => agent.setFunctionProfile([ profile ]), /Function profile didn't set\./);
      assert.match(errMessage, /Additional v8Options array includes an invalid v8 option --hello./);
    });

    it('should not set profile due to invalid v8 options (nodejs)', async () => {
      const profile: any = {
        name: 'node_worker_v8_options',
        runtime: 'nodejs-v16',
        url: `file://${baselineDir}/node_worker_v8_options`,
        handler: 'index.handler',
        signature: 'md5:234234',
        worker: {
          v8Options: [
            '--hello',
          ],
        },
      };

      control = new ControlPanel(config);
      const checkV8Options = control.herald.impl.checkV8Options;
      let errMessage = '';
      mm(control.herald.impl, 'checkV8Options', function(this: ControlPanel, profiles: RawFunctionProfile[]) {
        try {
          checkV8Options.call(this, profiles);
        } catch (e) {
          errMessage = (e as Error).message;
          throw e;
        }
      });
      mockClientCreatorForManager(DataPanelClientManager);
      mockClientCreatorForManager(_DataPanelClientManager);
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
      mockClientCreatorForManager(ControlPanelClientManager);
      mockClientCreatorForManager(DataPanelClientManager);
      await agent.start();
      agent.controlPanelClientManager.clients()[0].emit(Guest.events.CONNECTIVITY_STATE_CHANGED, Guest.connectivityState.CONNECTING);
      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);
    });

    it('should set platform environment variables', async () => {
      control = new ControlPanel(config);
      mockClientCreatorForManager(DataPanelClientManager);
      mockClientCreatorForManager(_DataPanelClientManager);
      await control.ready();
      await agent.start();

      assert.deepStrictEqual(control.platformEnvironmentVariables, {});

      await agent.setPlatformEnvironmentVariables(envs);

      assert.notStrictEqual(agent.platformEnvironmentVariables, envs);
      assert.deepStrictEqual(agent.platformEnvironmentVariables, envs);

      assert.deepStrictEqual(control.platformEnvironmentVariables, { foo: 'bar' });
    });

    it('should throw error if not string', async () => {
      control = new ControlPanel(config);
      mockClientCreatorForManager(DataPanelClientManager);
      mockClientCreatorForManager(_DataPanelClientManager);
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
      control = new ControlPanel(config);
      mockClientCreatorForManager(DataPanelClientManager);
      mockClientCreatorForManager(_DataPanelClientManager);
      await control.ready();
      await agent.start();

      assert.deepStrictEqual(control.platformEnvironmentVariables, {});

      await assert.rejects(agent.setPlatformEnvironmentVariables([ ...envs, { key: 'ALICE_你瞅啥', value: '瞅你咋地' }]), {
        message: /Platform environment variables' key can't start with ALICE_ and NOSLATE_. \(Failed: ALICE_你瞅啥\)/,
      });

      assert.deepStrictEqual(agent.platformEnvironmentVariables, []);
      assert.deepStrictEqual(control.platformEnvironmentVariables, {});
    });
  });

  describe('.setDaprAdaptor()', () => {
    it('should set dapr adapter success', async () => {
      control = new ControlPanel(config);
      data = new DataPanel(config);

      const spy = sinon.spy(data.dataFlowController.delegate, 'setDaprAdaptor');

      await control.ready();
      await data.ready();
      await agent.start();

      await agent.setDaprAdaptor(daprAdaptorDir);

      assert(spy.called);

      spy.restore();
    });

    it('should set dapr adapter before agent start work', async () => {
      await agent.setDaprAdaptor(daprAdaptorDir);

      control = new ControlPanel(config);
      data = new DataPanel(config);

      const spy = sinon.spy(data.dataFlowController.delegate, 'setDaprAdaptor');

      await control.ready();
      await data.ready();

      await agent.start();

      assert(spy.called);

      spy.restore();
    });

    it('should set dapr adapter when data panel client error', async () => {
      control = new ControlPanel(config);
      data = new DataPanel(config);

      await control.ready();
      await data.ready();

      await agent.start();
      await agent.setDaprAdaptor(daprAdaptorDir);

      const dataClient = agent.dataPanelClientManager.sample()!;
      const spy = sinon.spy(data.dataFlowController.delegate, 'setDaprAdaptor');

      // mock data panel client error, like: data panel restart ...
      dataClient.emit('error');

      await sleep(1000);

      assert(spy.called);

      spy.restore();
    });
  });
});
