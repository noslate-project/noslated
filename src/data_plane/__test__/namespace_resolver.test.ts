import * as common from '#self/test/common';
import * as sinon from 'sinon';
import { assertWorkerInvoke } from '#self/test/util';
import { kMegaBytes } from '#self/control_plane/constants';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('Namespace', () => {
    const env = new DefaultEnvironment();

    it('should use function as namespace', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo_with_storage',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        }
      ]);

      await assertWorkerInvoke(env.agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));
    });

    it('should use namespace config work', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo_with_storage',
          runtime: 'aworker',
          url: `file://${common.baselineDir}/aworker_storage`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
          namespace: 'aworker'
        }
      ]);

      await assertWorkerInvoke(env.agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));
    });

    it('should shard namespace work', async () => {
      await env.agent.setFunctionProfile([
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
      await assertWorkerInvoke(env.agent.invoke('aworker_echo_with_storage', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));

      // 读取共享 namespace kv storage 内容
      await assertWorkerInvoke(env.agent.invoke('aworker_echo_with_storage_shard', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.from('test-value'));

      // 未设置共享 namespace，使用默认方式，无法共享数据
      await assertWorkerInvoke(env.agent.invoke('aworker_echo_without_storage_shard', Buffer.alloc(0), {
        method: 'POST',
      }), Buffer.alloc(0));
    });
  });
});
