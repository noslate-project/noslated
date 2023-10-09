import assert from 'assert';
import { testName, baselineDir } from '#self/test/common';
import sinon from 'sinon';
import { PlatformEnvironsUpdatedEvent } from '#self/control_plane/events';
import { DefaultEnvironment } from '#self/test/env/environment';
import { bufferFromStream, sleep } from '#self/lib/util';
import { isEmpty } from 'lodash';

describe(testName(__filename), () => {
  const env = new DefaultEnvironment();

  describe('check plane health', function () {
    this.timeout(10000);

    it('should check control plane health work', async () => {
      const res = await env.agent.checkControlPlaneHealth();

      assert.strictEqual(res.name, 'ControlPlane');
      assert(res.health);
    });

    it('should check data plane health work', async () => {
      const res = await env.agent.checkDataPlaneHealth();

      assert.strictEqual(res.name, 'DataPlane');
      assert(res.health);
    });

    it('should check health false when circuit breaker enabled', async () => {
      const stub = sinon
        .stub(
          env.data.dataFlowController.circuitBreaker,
          '_getPendingRequestCount'
        )
        .callsFake(() => {
          return 10000;
        });

      // wait circuit breaker check 5 times
      await sleep(5000);

      const res = await env.agent.checkDataPlaneHealth();
      assert.strictEqual(res.name, 'DataPlane');
      assert(res.health === false);
      assert.strictEqual(res.reason, 'Circuit Breaker Enabled');

      stub.reset();
    });

    it('shoule check health false when control plane close', async () => {
      await env.control.close();
      const res = await env.agent.checkControlPlaneHealth();

      assert.strictEqual(res.name, 'ControlPlane');
      assert(res.health === false);
    });

    it('shoule check health false when data plane close', async () => {
      await env.data.close();
      const res = await env.agent.checkDataPlaneHealth();

      assert.strictEqual(res.name, 'DataPlane');
      assert(res.health === false);
    });
  });

  describe('.setPlatformEnvironmentVariables()', () => {
    const envs: any = [
      {
        key: 'foo',
        value: 'bar',
      },
    ];

    it('should set platform environment variables even if no client connected', async () => {
      const stub = sinon
        .stub(env.agent.controlPlaneClientManager, 'availableClients')
        .callsFake(() => {
          return [];
        });

      await env.agent.setPlatformEnvironmentVariables(envs);

      assert.deepStrictEqual(env.agent.platformEnvironmentVariables, envs);

      stub.reset();
    });

    it('should publish platform environment variables updated events', async () => {
      const spy = sinon.spy();
      const eventBus = env.control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: spy,
      });

      await env.agent.setPlatformEnvironmentVariables(envs);

      assert.deepStrictEqual(env.agent.platformEnvironmentVariables, envs);

      assert(spy.calledOnce);
      assert.deepStrictEqual(spy.args[0][0].data, {
        foo: 'bar',
      });
    });

    it('should throw error if not string', async () => {
      const spy = sinon.spy();
      const eventBus = env.control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: spy,
      });

      await assert.rejects(
        env.agent.setPlatformEnvironmentVariables([
          ...envs,
          { key: '你瞅啥', value: 1000 },
        ]),
        {
          message:
            /Platform environment variables' value can't be out of string. \(Failed: 你瞅啥, 1000 \(number\)\)/,
        }
      );

      assert.deepStrictEqual(env.agent.platformEnvironmentVariables, []);
      assert.strictEqual(spy.callCount, 0);
    });

    it('should throw error if reserved key hits', async () => {
      const spy = sinon.spy();
      const eventBus = env.control._ctx.getInstance('eventBus');
      eventBus.subscribe(PlatformEnvironsUpdatedEvent, {
        next: spy,
      });

      await assert.rejects(
        env.agent.setPlatformEnvironmentVariables([
          ...envs,
          { key: 'NOSLATED_你瞅啥', value: '瞅你咋地' },
        ]),
        {
          message:
            /Platform environment variables' key can't start with NOSLATED_ and NOSLATE_. \(Failed: NOSLATED_你瞅啥\)/,
        }
      );

      assert.deepStrictEqual(env.agent.platformEnvironmentVariables, []);
      assert.strictEqual(spy.callCount, 0);
    });
  });

  describe('.invoke()', () => {
    it('should invoke work', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      const response = await env.agent.invoke(
        'aworker_echo',
        Buffer.from('foobar'),
        {
          method: 'POST',
        }
      );

      const responseBuffer = await bufferFromStream(response);

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });
  });

  describe('.invokeService()', () => {
    it('should invokeService work', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      await env.agent.setServiceProfile([
        {
          name: 'aworker',
          type: 'default',
          selector: {
            functionName: 'aworker_echo',
          },
        },
      ]);

      const response = await env.agent.invokeService(
        'aworker',
        Buffer.from('foobar'),
        {
          method: 'POST',
        }
      );

      const responseBuffer = await bufferFromStream(response);

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });
  });

  describe('.getWorkerStatsSnapshot()', () => {
    it('should getWorkerStatsSnapshot work', async () => {
      let result = await env.agent.getWorkerStatsSnapshot();

      assert(isEmpty(result));

      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      await env.agent.invoke('aworker_echo', Buffer.from('foo'), {
        method: 'POST',
      });

      result = await env.agent.getWorkerStatsSnapshot();

      assert(!isEmpty(result));
    });
  });
});
