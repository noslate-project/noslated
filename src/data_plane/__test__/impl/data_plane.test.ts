import assert from 'assert';
import * as common from '#self/test/common';
import { Guest } from '#self/lib/rpc/guest';
import { descriptor } from '#self/lib/rpc/util';
import { bufferFromStream } from '#self/lib/util';
import { sleep } from '#self/lib/util';
import { config } from '#self/config';
import fs from 'fs';
import { getInspectorTargets } from '#self/test/diagnostics/util';
import { once } from 'events';
import { Events } from '#self/delegate/index';
import { DefaultEnvironment } from '#self/test/env/environment';
import { workerLogPath } from '#self/control_plane/container/container_manager';

const { baselineDir } = common;

describe(common.testName(__filename), () => {
  let guest: Guest;

  const env = new DefaultEnvironment();
  beforeEach(async () => {
    guest = new Guest(env.data.host.address);
    guest.addService((descriptor as any).noslated.data.DataPlane);
    await guest.start();
  });
  afterEach(async () => {
    await guest.close();
  });

  describe('getServiceProfile', () => {
    it('should inspect current service profiles', async () => {
      await env.agent.setServiceProfile([
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
      const [actualProfile] = ret.profiles;
      assert.deepStrictEqual(actualProfile, expectedProfile);
    });
  });

  describe('setTracingCategories', function () {
    this.timeout(10_000);

    it('should set tracing categories for existing processes', async () => {
      await env.agent.setFunctionProfile([
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
        const response = await env.agent.invoke('foobar', data, {
          method: 'POST',
        });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      await (guest as any).setTracingCategories({
        functionName: 'foobar',
        categories: ['v8', 'aworker'],
      });
      {
        const data = Buffer.from('foobar');
        const response = await env.agent.invoke('foobar', data, {
          method: 'POST',
        });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      // await flushing
      await sleep(2000);
      const containerName = Array.from(
        env.data.dataFlowController.getBroker('foobar')!.workers()
      )[0].name;
      const logDir = workerLogPath(config.logger.dir, containerName);
      const files = fs.readdirSync(logDir);

      assert(files.find(it => it.startsWith('aworker_trace')));
    });
  });

  describe('startInspector', function () {
    this.timeout(10_000);

    it('should start inspector for existing processes', async () => {
      await env.agent.setFunctionProfile([
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
        const response = await env.agent.invoke('foobar', data, {
          method: 'POST',
        });
        const buffer = await bufferFromStream(response);
        assert.strictEqual(buffer.toString('utf8'), 'foobar');
      }

      const inspectorFuture = once(
        env.data.dataFlowController.delegate,
        Events.inspectorStarted
      );
      await (guest as any).startInspector({ functionName: 'foobar' });
      await inspectorFuture;

      const targets = await getInspectorTargets();
      assert(Array.isArray(targets));
      assert.strictEqual(targets.length, 1);
    });
  });
});
