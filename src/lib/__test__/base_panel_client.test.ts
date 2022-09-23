import assert from 'assert';
import { sleep } from '#self/lib/util';
import { address, grpcDescriptor } from './rpc/util';
import { BasePanelClient } from '#self/lib/base_panel_client';
import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import * as root from '../../proto/test';
import { ServerWritableStream } from '@grpc/grpc-js';
import { Config } from "#self/config";

describe(common.testName(__filename), function() {
  let client: BasePanelClient;
  let host: Host;

  this.timeout(5000);

  beforeEach(async () => {
    host = new Host(address);
    await host.start();
  });

  afterEach(async () => {
    await client?.close();
    await host.close();
  });

  describe('#ready()', () => {
    it('should start', async () => {
      host.addService((grpcDescriptor as any).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          return { msg: call.request.msg };
        },
      });
      client = new BasePanelClient('foo', address, 1, { panel: { panelFirstConnectionTimeout: 500 } } as Config);

      assert.strictEqual(client.role, 'foo');
      assert.strictEqual(client.panelId, 1);

      client.addService((grpcDescriptor as any).alice.test.TestService);
      await client.ready();
      const resp = await (client as any).ping({ msg: 'foo' });
      assert.strictEqual(resp.msg, 'foo');
    });

    it('should start timeout', async () => {
      client = new BasePanelClient('foo', `${__dirname}/definitely-not-exists.sock`, 1, { panel: { panelFirstConnectionTimeout: 500 } } as Config);
      await assert.rejects(async () => {
        await client.ready();
      }, {
        message: /Failed to connect before the deadline/,
      });
    });

    it('should delay start', async () => {
      await host.close();
      client = new BasePanelClient('foo', address, 1, { panel: { panelFirstConnectionTimeout: 10_000 } } as Config);
      await sleep(500);
      host = new Host(address);
      host.addService((grpcDescriptor as any).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          return { msg: call.request.msg };
        },
      });
      host.start();
      await client.ready();
      client.addService((grpcDescriptor as any).alice.test.TestService);

      assert.strictEqual(client.role, 'foo');
      assert.strictEqual(client.panelId, 1);

      const resp = await (client as any).ping({ msg: 'foo' });
      assert.strictEqual(resp.msg, 'foo');
    });
  });
});
