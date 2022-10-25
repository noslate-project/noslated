import assert from 'assert';
import * as common from '#self/test/common';
import { daemonProse, ProseContext } from '#self/test/util';
import { Guest } from '#self/lib/rpc/guest';
import { descriptor } from '#self/lib/rpc/util';
import { bufferFromStream } from '#self/lib/util';
import { sleep } from '#self/lib/util';
import { config } from '#self/config';
import fs from 'fs';
import { BaseStarter } from '#self/control_plane/starter/base';
import { getInspectorTargets } from '#self/test/diagnostics/util';
import { once } from 'events';
import { Events } from '#self/delegate/index';
import sinon from 'sinon';
import path from 'path';

const { baselineDir, daprAdaptorDir } = common;

describe(common.testName(__filename), () => {
  const roles: ProseContext = {};
  let guest: Guest;

  daemonProse(roles);
  beforeEach(async () => {
    guest = new Guest(roles.data!.host.address);
    guest.addService((descriptor as any).noslated.data.DataPlane);
    await guest.start();
  });
  afterEach(async () => {
    await guest.close();
  });

  describe('getServiceProfile', () => {
    it('should inspect current service profiles', async () => {
      await roles.agent!.setServiceProfile([
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
      const expectedProfile = {
        name: 'foobar',
        type: 'proportional-load-balance',
        selectors: [
          {
            selector: [
              {
                key: 'functionName',
                value: 'node_worker_echo',
              },
            ],
            proportion: 0.5,
          },
          {
            selector: [
              {
                key: 'functionName',
                value: 'non-exists',
              },
            ],
            proportion: 0.5,
          },
        ],
      };

      const ret = await (guest as any).getServiceProfiles({});
      assert.strictEqual(ret.profiles.length, 1);
      const [ actualProfile ] = ret.profiles;
      assert.deepStrictEqual(actualProfile, expectedProfile);
    });
  });

  describe('setTracingCategories', function() {
    this.timeout(10_000);

    it('should set tracing categories for existing processes', async () => {
      const { agent } = roles;
      await agent!.setFunctionProfile([
        {
          name: 'foobar',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      {
        const data = Buffer.from('foobar');
        const response = await agent!.invoke('foobar', data, { method: 'POST' });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      await (guest as any).setTracingCategories({ functionName: 'foobar', categories: [ 'v8', 'aworker' ] });
      {
        const data = Buffer.from('foobar');
        const response = await agent!.invoke('foobar', data, { method: 'POST' });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      // await flushing
      await sleep(2000);
      const containerName = roles.data!.dataFlowController!.getBroker('foobar')!.workers[0].name;
      const logDir = BaseStarter.logPath(config.logger.dir, containerName);
      const files = fs.readdirSync(logDir);

      assert(files.find(it => it.startsWith('aworker_trace')));
    });
  });

  describe('startInspector', function() {
    this.timeout(10_000);

    it('should start inspector for existing processes', async () => {
      const { agent } = roles;
      await agent!.setFunctionProfile([
        {
          name: 'foobar',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      {
        const data = Buffer.from('foobar');
        const response = await agent!.invoke('foobar', data, { method: 'POST' });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      const inspectorFuture = once(roles.data!.dataFlowController.delegate, Events.inspectorStarted);
      await (guest as any).startInspector({ functionName: 'foobar' });
      await inspectorFuture;

      const targets = await getInspectorTargets();
      assert(Array.isArray(targets));
      assert.strictEqual(targets.length, 1);
    });
  });

  describe('setDaprAdaptor', () => {
    it('should setDaprAdaptor work', async () => {
      const modulePath = path.join(daprAdaptorDir, 'index');
      const Clz = require(modulePath);
      const stub = sinon.stub(Clz.prototype, 'ready');
      await roles.agent!.setDaprAdaptor(modulePath);
      assert.strictEqual(stub.callCount, 1);
      stub.restore();
    });

    it('should close DaprAdaptor when ready failed', async () => {
      const modulePath = path.join(daprAdaptorDir, 'index');
      const Clz = require(modulePath);
      const stubReady = sinon.stub(Clz.prototype, 'ready').callsFake(async () => {
        throw new Error('MockReadyError');
      });
      const stubClose = sinon.stub(Clz.prototype, 'close');

      try {
        await roles.agent!.setDaprAdaptor(modulePath);
      } catch (error) {
        assert((error as Error).message.includes('MockReadyError'));
      }

      assert.strictEqual(stubReady.callCount, 1);
      assert.strictEqual(stubClose.callCount, 1);

      stubReady.restore();
      stubClose.restore();
    });
  });
});
