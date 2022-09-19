import { DataPlaneBeaconHost } from '#self/data_plane/namespace_resolver';
import { createLogger, IMidwayLogger } from '@midwayjs/logger';
import * as common from '#self/test/common';
import * as sinon from 'sinon';
import * as assert from 'assert';
import { startTurfD, stopTurfD, turf } from '#self/lib/turf';
import { assertWorkerInvoke, Roles, startAllRoles } from '#self/test/util';
import { DataPlane } from '../data_plane';
import { AliceAgent } from '#self/sdk';
import { ControlPlane } from '#self/control_plane';
import { kMegaBytes } from '#self/control_plane/constants';

describe(common.testName(__filename), () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('DataPlaneBeaconHost', () => {
    it('should write beacon data', async () => {
      const logger: IMidwayLogger = createLogger('test.log', {
        enableFile: false,
        enableError: false,
      });
      const writeStub = sinon.stub(logger, 'write');
      const beaconHost = new DataPlaneBeaconHost(logger);
      await beaconHost.sendBeacon('trace', { format: 'trace' }, Buffer.from('foobar'));

      assert.ok(writeStub.calledOnce);
    });

    it('should ignore unrecognized beacon data', async () => {
      const logger: IMidwayLogger = createLogger('test.log', {
        enableFile: false,
        enableError: false,
      });
      const writeStub = sinon.stub(logger, 'write');
      const beaconHost = new DataPlaneBeaconHost(logger);
      await beaconHost.sendBeacon('metrics', { format: 'trace' }, Buffer.from('foobar'));
      await beaconHost.sendBeacon('foobar', { format: 'stats' }, Buffer.from('foobar'));

      assert.ok(!writeStub.called);
    });
  });

  describe('Namespace', () => {
    let data: DataPlane;
    let agent: AliceAgent;
    let control: ControlPlane;

    beforeEach(async () => {
      await startTurfD();
      await turf.destroyAll();
      const roles = await startAllRoles() as Required<Roles>;
      data = roles.data;
      agent = roles.agent;
      control = roles.control;
    });

    afterEach(async () => {
      if (data) {
        await Promise.all([
          data.close(),
          agent.close(),
          control.close(),
        ]);
      }

      await stopTurfD();
    });

    it('should use function as namespace', async () => {
      await agent.setFunctionProfile([
        {
          name: 'aworker_echo_with_storage',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        }
      ]);

      await assertWorkerInvoke(agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));
    });

    it('should use namespace config work', async () => {
      await agent.setFunctionProfile([
        {
          name: 'aworker_echo_with_storage',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          namespace: 'aworker'
        }
      ]);

      await assertWorkerInvoke(agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));
    });

    it('should shard namespace work', async () => {
      await agent.setFunctionProfile([
        {
          name: 'aworker_echo_with_storage',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          namespace: 'shared',
          resourceLimit: {
            memory: 100 * kMegaBytes
          }
        },
        {
          name: 'aworker_echo_with_storage_shard',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage_shared`,
          sourceFile: 'index.js',
          signature: 'md5:2342345',
          namespace: 'shared',
          resourceLimit: {
            memory: 100 * kMegaBytes
          }
        },
        {
          name: 'aworker_echo_without_storage_shard',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage_shared`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          resourceLimit: {
            memory: 100 * kMegaBytes
          }
        }
      ]);

      // 设置 kv storage 内容
      await assertWorkerInvoke(agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));

      // 读取共享 namespace kv storage 内容
      await assertWorkerInvoke(agent.invoke('aworker_echo_with_storage_shard', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));

      // 未设置共享 namespace，使用默认方式，无法共享数据
      await assertWorkerInvoke(agent.invoke('aworker_echo_without_storage_shard', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.alloc(0));
    });
  });
});
