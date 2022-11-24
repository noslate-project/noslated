import path from 'path';

import address from 'address';
import mm from 'mm';

import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import * as naming from '#self/lib/naming';
import { startTurfD, stopTurfD, TurfContainerStates } from '#self/lib/turf';
import { ResourceServer } from './resource-server';
import { testWorker, startAllRoles, Roles, TurfContext, ProseContext } from '../util';
import { config } from '#self/config';
import assert from 'assert';
import { CanonicalCode } from '#self/delegate/index';
import { sleep } from '#self/lib/util';
import { NoslatedClient } from '#self/sdk/index';
import { DataPlane } from '#self/data_plane';
import { ControlPlane } from '#self/control_plane';
import { ContainerStatus } from '#self/lib/constants';
import sinon, { SinonSpy } from 'sinon';

const cases = [
  {
    name: 'node_worker_echo',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
  },
  {
    name: 'node_worker_echo_req_metadata',
    profile: {
      name: 'node_worker_echo_req_metadata',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'req_metadata.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        url: 'http://example.com/foobar',
        // Although body of GET requests should be empty, node.js worker does
        // support populate that.
        method: 'GET',
        headers: [
          [ 'foo', 'bar' ],
        ],
        baggage: [
          [ 'foo', 'bar' ],
        ],
      },
    },
    expect: {
      data: Buffer.from(JSON.stringify({
        url: 'http://example.com/foobar',
        method: 'GET',
        headers: {
          foo: 'bar',
        },
        baggage: {
          foo: 'bar',
        },
      })),
    },
  },
  {
    name: 'node_worker_echo_res_metadata',
    profile: {
      name: 'node_worker_echo_res_metadata',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'res_metadata.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        url: 'http://example.com/foobar',
        method: 'GET',
        headers: [
          [ 'foo', 'bar' ],
        ],
      },
    },
    expect: {
      data: Buffer.from(''),
      status: 200,
      metadata: {
        headers: [
          [ 'foo', 'bar' ],
        ],
      },
    },
  },
  {
    name: 'node_worker_echo_with_initializer',
    profile: {
      name: 'node_worker_echo_with_initializer',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'with_initializer.handler',
      initializer: 'with_initializer.initializer',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from(''),
      status: 200,
      metadata: {
        headers: [
          [ 'x-initialized', 'true' ],
        ],
      },
    },
  },
  {
    name: 'node_worker_dapr_invoke',
    profile: {
      name: 'node_worker_dapr_invoke',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'invoke.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: JSON.stringify({
        status: 200,
        text: JSON.stringify({ appId: 'hello-world', methodName: 'echo', data: 'foobar' }),
      }),
    },
  },
  {
    name: 'node_worker_dapr_invoke_non_200_status',
    profile: {
      name: 'node_worker_dapr_invoke',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'invoke.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        headers: [
          [ 'DAPR_METHOD', '-。-' ],
        ],
      },
    },
    expect: {
      data: JSON.stringify({
        status: 500,
        text: 'unknown operation',
      }),
    },
  },
  {
    name: 'node_worker_dapr_binding',
    profile: {
      name: 'node_worker_dapr_binding',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'binding.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: JSON.stringify({
        status: 200,
        text: JSON.stringify({
          name: 'key-value',
          metadata: { foo: '[object Object]' },
          operation: 'get',
          data: 'foobar',
        }),
      }),
    },
  },
  {
    name: 'node_worker_dapr_binding_non_200_status',
    profile: {
      name: 'node_worker_dapr_binding',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'binding.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        headers: [
          [ 'DAPR_OPERATION', '-。-' ],
        ],
      },
    },
    expect: {
      data: JSON.stringify({
        status: 500,
        text: 'unknown operation',
      }),
    },
  },
  {
    before: async (roles: BaseLineTestContext) => {
      const spy = sinon.spy(roles.data.dataFlowController.namespaceResolver.beaconHost, 'sendBeacon');

      return spy;
    },
    name: 'node_worker_beacon',
    profile: {
      name: 'node_worker_beacon',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_beacon`,
      handler: 'index.handler',
      signature: 'md5:200011',
    },
    input: {
      name: 'node_worker_beacon',
      metadata: {
        headers: [
          [ 'trace-id', 'a-unique-trace-node-id' ],
        ],
      },
    },
    after: async (roles: BaseLineTestContext, beforeRet: any) => {
      const spy: SinonSpy = beforeRet;
      const written = spy.args[0]?.[2];
      assert.ok(Buffer.from('node_worker_beacon|a-unique-trace-node-id\n').equals(written as any));
      spy.restore();
    },
    expect: {},
  },
  {
    name: 'aworker_echo',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        // ServiceWorker doesn't support populate GET requests body. As
        // Request in Fetch Spec disallow that.
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
  },
  {
    name: 'aworker_echo_large_data',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'.repeat(1024 * 1024)),
      metadata: {
        // ServiceWorker doesn't support populate GET requests body. As
        // Request in Fetch Spec disallow that.
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('foobar'.repeat(1024 * 1024)),
    },
  },
  {
    name: 'aworker_echo_req_metadata',
    profile: {
      name: 'aworker_echo_req_metadata',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'req_metadata.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        url: 'http://example.com/foo',
        method: 'GET',
        headers: [
          [ 'foo', 'bar' ],
        ],
      },
    },
    expect: {
      data: Buffer.from(JSON.stringify({
        url: 'http://example.com/foo',
        method: 'GET',
        headers: [
          [ 'foo', 'bar' ],
        ],
      })),
    },
  },
  {
    name: 'aworker_echo_res_metadata',
    profile: {
      name: 'aworker_echo_res_metadata',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'res_metadata.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        url: 'http://example.com/foo',
        method: 'GET',
        headers: [
          [ 'foo', 'bar' ],
        ],
      },
    },
    expect: {
      data: Buffer.from(''),
      metadata: {
        headers: [
          [ 'foo', 'bar' ],
        ],
      },
    },
  },
  {
    name: 'aworker_echo_with_initializer',
    profile: {
      name: 'aworker_echo_with_initializer',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'with_initializer.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from(''),
      metadata: {
        headers: [
          [ 'x-installed', 'true' ],
        ],
      },
    },
  },
  {
    name: 'aworker_dapr_invoke',
    profile: {
      name: 'aworker_dapr_invoke',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'invoke.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from('{"appId":"hello-world","methodName":"echo","data":"foobar"}'),
    },
  },
  {
    name: 'aworker_dapr_invoke_non_200_status',
    profile: {
      name: 'aworker_dapr_invoke',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'invoke.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        headers: [
          [ 'DAPR_METHOD', 'not a recognizable method' ],
        ],
      },
    },
    expect: {
      status: 500,
      data: 'unknown operation',
    },
  },
  {
    name: 'aworker_dapr_binding',
    profile: {
      name: 'aworker_dapr_binding',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'binding.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: JSON.stringify({
        name: 'key-value',
        metadata: {
          foo: '[object Object]',
        },
        operation: 'get',
        data: 'foobar',
      }),
    },
  },
  {
    name: 'aworker_dapr_binding_non_200_status',
    profile: {
      name: 'aworker_dapr_binding',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'binding.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {
        headers: [
          [ 'DAPR_OPERATION', 'not a recognizable operation' ],
        ],
      },
    },
    expect: {
      status: 500,
      data: 'unknown operation',
    },
  },
  {
    name: 'aworker_cache',
    profile: {
      name: 'aworker_cache',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_cache`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: '',
    },
    expect: {
      data: 'foobar',
    },
  },
  {
    name: 'aworker_fetch',
    profile: {
      name: 'aworker_fetch',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_fetch`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(`http://localhost:${ResourceServer.port}/hello-world`),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('hello world'),
      metadata: {
        headers: [
          [ 'x-powered-by', 'Express' ],
          [ 'content-length', '11' ],
          [ 'x-anc-remote-address', '127.0.0.1' ],
          [ 'x-anc-remote-family', 'IPv4' ],
          [ 'x-anc-remote-port', `${ResourceServer.port}` ],
        ],
      },
    },
    after: async (roles: BaseLineTestContext) => {
      const resourceUsages = roles.data.dataFlowController.getResourceUsages()
        .filter((it) => it!.functionName === 'aworker_fetch');
      assert.strictEqual(resourceUsages.length, 1);
      assert.strictEqual(resourceUsages[0]!.activeFetchRequestCount, 0);
    },
  },
  {
    name: 'aworker_fetch_body_error',
    profile: {
      name: 'aworker_fetch_body_error',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_fetch`,
      sourceFile: 'body-error.js',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {},
    },
    expect: {
      data: 'TypeError: Failed to drain request body',
    },
    after: async (roles: BaseLineTestContext) => {
      const resourceUsages = roles.data.dataFlowController.getResourceUsages()
        .filter((it) => it!.functionName === 'aworker_fetch_body_error');
      assert.strictEqual(resourceUsages.length, 1);
      assert.strictEqual(resourceUsages[0]!.activeFetchRequestCount, 0);
    },
  },
  {
    name: 'aworker_error_sync_uncaught',
    profile: {
      name: 'aworker_error_sync_uncaught',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_error`,
      sourceFile: 'sync_uncaught.js',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {},
    },
    expect: {
      error: {
        name: 'NoslatedError',
        message: /CanonicalCode::INTERNAL_ERROR/,
        code: CanonicalCode.INTERNAL_ERROR,
        peerStack: /Error: foobar\n\s+.+sync_uncaught.js:4:9/m,
      },
    },
  },
  {
    name: 'aworker_error_promise_unhandled',
    profile: {
      name: 'aworker_error_promise_unhandled',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_error`,
      sourceFile: 'promise_unhandled.js',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {},
    },
    expect: {
      error: {
        name: 'NoslatedError',
        message: /CanonicalCode::INTERNAL_ERROR/,
        code: CanonicalCode.INTERNAL_ERROR,
        peerStack: /Error: foobar\n\s+.+promise_unhandled.js:4:36/m,
      },
    },
  },
  {
    name: 'node_worker_echo_startup_fastfail',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        fastFailRequestsOnStarting: true,
      },
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      error: {
        message: /No available worker process for node_worker_echo now\./,
      },
    },
    after: async (roles: BaseLineTestContext) => {
      // 虽然在启动阶段检验要 fastfail，但是仍然要在测试之后检测在 fastfail 之后，Worker 进程是否仍然被
      // 正常启动，所以用一个 loop 去轮询，直至 worker 正常为止。
      // 若不正常，则触发 mocha 超时，导致失败。
      do {
        await sleep(10);
        const worker = roles.data.dataFlowController.getBroker('node_worker_echo')!.getAvailableWorker();
        if (!worker) continue;
        const ps = await roles.turf.ps();
        for (const p of ps) {
          if (p.status === 'running' && p.name === worker.name) return;
        }
      } while (true);
    },
  },
  {
    name: 'node_worker_echo_no_enough_memory_pool_fastfail',
    before: async (roles: BaseLineTestContext) => {
      mm(roles.control.capacityManager, 'virtualMemoryPoolSize', 1);
    },
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      error: {
        message: /No enough virtual memory to start worker process for node_worker_echo now\./,
      },
    },
  },
  {
    name: 'node_worker_echo_url_404_fastfail',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `http://localhost:${ResourceServer.port}/404`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      error: {
        message: /Failed to ensure \(or download\) code for node_worker_echo now\./,
      },
    },
  },
  {
    name: 'aworker_echo_seed_mode',
    profile: {
      name: 'aworker_echo_seed_mode',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        // ServiceWorker doesn't support populate GET requests body. As
        // Request in Fetch Spec disallow that.
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
    seed: true,
  },
  {
    name: 'node_worker_cwd',
    profile: {
      name: 'node_worker_cwd',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_cwd_symbol_link`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from(path.join(baselineDir, 'node_worker_cwd')),
    },
  },
  {
    name: 'node_worker_env',
    profile: {
      name: 'node_worker_env',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_env`,
      handler: 'index.handler',
      signature: 'md5:234234',
      environments: [{
        key: 'foo',
        value: 'bar',
      }],
    },
    input: {
      data: null,
      metadata: {},
    },
    before: async (roles: BaseLineTestContext) => {
      mm(process.env, 'TZ', 'Asia/Tokyo');
      mm(naming, 'processName', () => 'hello-world');
      mm(naming, 'codeBundleName', () => 'bundle-name');
      await roles.agent.setPlatformEnvironmentVariables([{
        key: 'POD_IP',
        value: address.ip(),
      }]);
    },
    expect: {
      data: Buffer.from(JSON.stringify({
        PATH: '/bin:/usr/bin',
        TERM: 'xterm',
        TZ: 'Asia/Tokyo',
        POD_IP: address.ip(),
        foo: 'bar',
        NOSLATE_WORKER_ID: 'hello-world',
        HOME: `${config.dirs.noslatedWork}/bundles/bundle-name/code`,
      })),
    },
  },
  {
    name: 'aworker_env',
    profile: {
      name: 'aworker_env',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_env`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      environments: [{
        key: 'foo',
        value: 'bar',
      }],
    },
    input: {
      data: null,
      metadata: {},
    },
    before: async (roles: BaseLineTestContext) => {
      mm(process.env, 'TZ', 'Asia/Tokyo');
      mm(naming, 'processName', () => 'hello-world-ii');
      mm(naming, 'codeBundleName', () => 'bundle-name-ii');
      await roles.agent.setPlatformEnvironmentVariables([{
        key: 'POD_IP',
        value: address.ip(),
      }, {
        key: 'NULL',
        value: null,
      }, {
        key: 'UNDEFINED',
        value: undefined,
      }]);
    },
    expect: {
      data: Buffer.from(JSON.stringify({
        PATH: '/bin:/usr/bin',
        TERM: 'xterm',
        TZ: 'Asia/Tokyo',
        POD_IP: address.ip(),
        NULL: '',
        UNDEFINED: '',
        foo: 'bar',
        NOSLATE_WORKER_ID: 'hello-world-ii',
        HOME: `${config.dirs.noslatedWork}/bundles/bundle-name-ii/code`,
      })),
    },
  },
  {
    name: 'aworker_env_timezone',
    profile: {
      name: 'aworker_env_timezone',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_env`,
      sourceFile: 'timezone.js',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {},
    },
    before: async () => {
      mm(process.env, 'TZ', 'Asia/Tokyo');
    },
    expect: {
      data: Buffer.from(JSON.stringify({
        TZ: 'Asia/Tokyo',
        exemplar: '2022-02-24T05:28:38.000Z',
      })),
    },
  },
  {
    before: async (roles: BaseLineTestContext) => {
      const spy = sinon.spy(roles.data.dataFlowController.namespaceResolver.beaconHost, 'sendBeacon');

      return spy;
    },
    name: 'aworker_beacon',
    profile: {
      name: 'aworker_beacon',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_beacon`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: null,
      metadata: {
        headers: [
          [ 'trace-id', 'a-unique-trace-id' ],
        ],
      },
    },
    after: async (roles: BaseLineTestContext, beforeRet: any) => {
      const spy: SinonSpy = beforeRet;
      const written = spy.args[0]?.[2];
      assert.ok(Buffer.from('aworker_beacon|a-unique-trace-id\n').equals(written as any));
      spy.restore();
    },
    expect: {},
  },
  {
    name: 'node_worker_without_disposable_true',
    profile: {
      name: 'node_worker_without_disposable_true',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'invoke.handler',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: JSON.stringify({
        status: 200,
        text: JSON.stringify({ appId: 'hello-world', methodName: 'echo', data: 'foobar' }),
      }),
    },
    after: async (roles: Required<ProseContext<TurfContext>>) => {
      const broker = roles.control.capacityManager.workerStatsSnapshot.getBroker('node_worker_without_disposable_true', false)!;
      assert.deepStrictEqual(broker.workers.size, 1);
      const worker = broker.workers.values().next().value;
      assert.deepStrictEqual(worker.containerStatus, ContainerStatus.Ready);
      assert.deepStrictEqual(worker.turfContainerStates, TurfContainerStates.running);
    }
  },
  {
    name: 'node_worker_with_disposable_true',
    profile: {
      name: 'node_worker_with_disposable_true',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_dapr`,
      handler: 'invoke.handler',
      signature: 'md5:234234',
      worker: {
        disposable: true
      }
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: JSON.stringify({
        status: 200,
        text: JSON.stringify({ appId: 'hello-world', methodName: 'echo', data: 'foobar' }),
      }),
    },
    after: async (roles: Required<ProseContext<TurfContext>>) => {
      const broker = roles.control.capacityManager.workerStatsSnapshot.getBroker('node_worker_with_disposable_true', false)!;
      assert.deepStrictEqual(broker.workers.size, 1);
      const worker = broker.workers.values().next().value;
      assert.deepStrictEqual(worker.containerStatus, ContainerStatus.Stopped);
      assert.deepStrictEqual(worker.turfContainerStates, TurfContainerStates.running);
      // wait turf kill or sync gc
      await sleep(3000);
      assert.deepStrictEqual(broker.workers.size, 0);
    }
  },
  {
    name: 'aworker_without_disposable_true',
    profile: {
      name: 'aworker_without_disposable_true',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'invoke.js',
      signature: 'md5:234234',
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from('{"appId":"hello-world","methodName":"echo","data":"foobar"}'),
    },
    after: async (roles: Required<ProseContext<TurfContext>>) => {
      const broker = roles.control.capacityManager.workerStatsSnapshot.getBroker('aworker_without_disposable_true', false)!;
      assert.deepStrictEqual(broker.workers.size, 1);
      const worker = broker.workers.values().next().value;
      assert.deepStrictEqual(worker.containerStatus, ContainerStatus.Ready);
      assert.deepStrictEqual(worker.turfContainerStates, TurfContainerStates.running);
    }
  },
  {
    name: 'aworker_with_disposable_true',
    profile: {
      name: 'aworker_with_disposable_true',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_dapr`,
      sourceFile: 'invoke.js',
      signature: 'md5:234234',
      worker: {
        disposable: true
      }
    },
    input: {
      // empty body in GET request.
      data: null,
      metadata: {},
    },
    expect: {
      data: Buffer.from('{"appId":"hello-world","methodName":"echo","data":"foobar"}'),
    },
    after: async (roles: Required<ProseContext<TurfContext>>) => {
      const broker = roles.control.capacityManager.workerStatsSnapshot.getBroker('aworker_with_disposable_true', false)!;
      assert.deepStrictEqual(broker.workers.size, 1);
      const worker = broker.workers.values().next().value;
      assert.deepStrictEqual(worker.containerStatus, ContainerStatus.Stopped);
      assert.deepStrictEqual(worker.turfContainerStates, TurfContainerStates.running);
      // wait turf kill or sync gc
      await sleep(3000);
      assert.deepStrictEqual(broker.workers.size, 0);
    }
  },
  {
    before: async (roles: BaseLineTestContext) => {
      return sinon.spy(roles.data.dataFlowController, 'invoke');
    },
    name: 'node_worker_echo_with_request_id',
    profile: {
      name: 'node_worker_echo_with_request_id',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
        requestId: 'node_worker_echo_with_request_id'
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
    after: async (roles: BaseLineTestContext, beforeRet: any) => {
      const spy: SinonSpy = beforeRet;
      const spyCall = spy.getCall(-1);
      assert.strictEqual(spyCall.args[2].requestId, 'node_worker_echo_with_request_id');
      spy.restore();
    }
  },
  {
    before: async (roles: BaseLineTestContext) => {
      return sinon.spy(roles.data.dataFlowController, 'invoke');
    },
    name: 'aworker_echo_with_request_id',
    profile: {
      name: 'aworker_echo_with_request_id',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        // ServiceWorker doesn't support populate GET requests body. As
        // Request in Fetch Spec disallow that.
        method: 'POST',
        requestId: 'aworker_echo_with_request_id'
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
    after: async (roles: BaseLineTestContext, beforeRet: any) => {
      const spy: SinonSpy = beforeRet;
      const spyCall = spy.getCall(-1);
      assert.strictEqual(spyCall.args[2].requestId, 'aworker_echo_with_request_id');
      spy.restore();
    }
  }
];

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;
  before(async () => {
    resourceServer = new ResourceServer();
    await resourceServer.start();
  });

  after(async () => {
    await resourceServer.close();
  });

  for (const type of [ /* 'native', */ 'noslated' ]) {
    describe(`${type} server`, () => {
      beforeEach(async () => {
        mm(config.delegate, 'type', type);
        mm(config.dataPlane, 'daprAdaptorModulePath', require.resolve('./dapr-adaptor'));
        await startTurfD();
        const roles = await startAllRoles() as Required<Roles>;
        data = roles.data;
        agent = roles.agent;
        control = roles.control;
        await control.turf.destroyAll();
      });

      afterEach(async () => {
        mm.restore();
        if (data) {
          await Promise.all([
            data.close(),
            agent.close(),
            control.close(),
          ]);
        }

        await stopTurfD();
      });

      for (const item of cases as any[]) {
        const _it = (item.seed && process.platform === 'darwin') ? it.skip : it;
        _it(item.name, async () => {
          if (item.seed) {
            // Default CI is non seed mode. Mock it to seed mode and then restart all roles.
            mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');
            await Promise.all([ data.close(), agent.close(), control.close() ]);
            ({ data, agent, control } = await startAllRoles() as Required<Roles>);
          }

          let beforeRet;

          if (item.before) {
            beforeRet = await item.before({ agent, control, data, turf: control.turf });
          }

          await agent.setFunctionProfile([ item.profile ]);
          await testWorker(agent!, item);
          if (item.after) {
            await item.after({ agent, control, data, turf: control.turf }, beforeRet);
          }
        });
      }
    });
  }
});

type BaseLineTestContext = Required<ProseContext<TurfContext>>;
