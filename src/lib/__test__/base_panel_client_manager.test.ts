import assert from "assert";
import path from "path";
import { sleep } from '#self/lib/util';
import { address, grpcDescriptor, once } from './rpc/util';
import { BasePanelClient } from '#self/lib/base_panel_client';
import { BasePanelClientManager } from '#self/lib/base_panel_client_manager';
import * as common from '#self/test/common';
import { createDeferred } from '#self/lib/util';
import { Guest } from '#self/lib/rpc/guest';
import { Host } from '#self/lib/rpc/host';
import loggers from '#self/lib/logger';
import { Config } from "#self/config";
import * as root from '../../proto/test';
import { ServerWritableStream } from '@grpc/grpc-js';

class Manager extends BasePanelClientManager {
  _createPanelClient(panelId: number) {
    const client = new BasePanelClient('foo', address, panelId, this.config);
    client.addService((grpcDescriptor as any).alice.test.TestService);
    return client;
  }

  _onClientReady(client: BasePanelClient & { readyCount: number }) {
    super._onClientReady(client);
    if (!client.readyCount) client.readyCount = 0;
    client.readyCount++;
  }
}

describe(common.testName(__filename), function() {
  let host: Host;
  let manager: Manager;
  const addressDirname = path.dirname(address.substr('unix://'.length));

  this.timeout(5000);

  beforeEach(async () => {
    host = new Host(address);
    await host.start();
  });

  afterEach(async () => {
    await manager?.close();
    try {
      await host.close();
    } catch (e) {
      // ignore
    }
  });

  describe('#ready()', () => {
    it('should start', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();
    });

    it('should start timeout', async () => {
      await host.close();

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await assert.rejects(manager.ready(), {
        message: /Timeout on waiting first panel client ready/,
      });
    });

    it('should emit newClientReady', async () => {
      const clients: BasePanelClient[] = [];
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      manager.on('newClientReady', client => {
        clients.push(client);
      });

      await manager.ready();
      clients.sort((a, b) => { return a.panelId < b.panelId ? -1 : 1; });

      assert.ok(clients.length > 0);
    });
  });

  describe('#clients()', () => {
    it('should return all clients', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();
      assert.strictEqual(manager.clients().length, 2);
    });

    it('should return all clients even if host closed', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));

      await manager.ready();
      assert.strictEqual(manager.clients().length, 2);

      await host.close();
      await sleep(100);

      assert.strictEqual(manager.clients().length, 2);
      assert.deepStrictEqual(manager.availableClients(), []);
    });

    it('should return all clients even if one client failed', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));

      await manager.ready();
      assert.strictEqual(manager.clients().length, 2);

      manager.clients()[0].emit(Guest.events.CONNECTIVITY_STATE_CHANGED, Guest.connectivityState.CONNECTING);

      assert.strictEqual(manager.clients().length, 2);
    });
  });

  describe('#availableClients()', () => {
    it('should return all clients', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      assert.ok(manager.availableClients().length > 0);
    });

    it('should return no client', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      await host.close();
      await sleep(100);

      assert.deepStrictEqual(manager.availableClients(), []);
    });

    it('should return only one client', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      const availableClientsLength = manager.availableClients().length;
      assert.ok(availableClientsLength > 0);
      manager.availableClients()[0].emit(Guest.events.CONNECTIVITY_STATE_CHANGED, Guest.connectivityState.CONNECTING);
      assert.strictEqual(manager.availableClients().length, availableClientsLength - 1);
    });
  });

  describe('_onClientReady()', () => {
    it('should call _onClientReady() after client reconnected', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      await host.close();
      await sleep(100);

      const { resolve, promise } = createDeferred<void>();
      let newClientReadyCount = 0;
      manager.on('newClientReady', () => {
        newClientReadyCount++;
        if (newClientReadyCount === 2) {
          resolve();
        }
      });
      host = new Host(address);
      host.start();

      await promise;

      manager.clients().forEach((client: BasePanelClient & { readyCount?: number; }) => {
        assert.strictEqual(client.readyCount, 2);
      });
    });
  });

  describe('sample()', () => {
    it('should sample()', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 10, loggers.get('manager'));
      await manager.ready();

      assert(manager.availableClients().includes(manager.sample()!));
    });

    it('should sample() null', async () => {
      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();
      await host.close();
      await sleep(100);

      assert.strictEqual(manager.sample(), null);
    });
  });

  describe('#callToAllAvailableClients', () => {
    it('should call all clients', async () => {
      host.addService((grpcDescriptor as any).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          return { msg: call.request.msg };
        },
      });

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      const ret = await manager.callToAllAvailableClients('ping', [{ msg: 'hello' }], 'all');
      assert.deepStrictEqual(ret, [{ msg: 'hello' }]);
    });

    it('should call no client', async () => {
      host.addService((grpcDescriptor as any ).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          return { msg: call.request.msg };
        },
      });

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      await host.close();
      await sleep(100);

      const ret = await manager.callToAllAvailableClients('ping', [{ msg: 'hello' }], 'all');
      assert.deepStrictEqual(ret, []);
    });

    it('should call all clients (allSettled)', async () => {
      host.addService((grpcDescriptor as any ).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          return { msg: call.request.msg };
        },
      });

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();

      const ret = await manager.callToAllAvailableClients('ping', [{ msg: 'hello' }], 'allSettled');
      assert.deepStrictEqual(ret, [{ value: { msg: 'hello' }, status: 'fulfilled' }]);
    });

    it('should call all clients (allSettled with error)', async () => {
      let pingTimes = 0;
      host.addService((grpcDescriptor as any ).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          pingTimes++;
          if (pingTimes === 1) {
            return { msg: call.request.msg };
          }

          throw new Error('foo');
        },
      });
      host.once('error', () => {});

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();
      // wait second client ready.
      await once(manager, 'newClientReady');

      const ret = await manager.callToAllAvailableClients('ping', [{ msg: 'hello' }], 'allSettled');
      ret.sort((a: { status: string; }) => (a.status === 'fulfilled' ? -1 : 1));
      assert.deepStrictEqual(ret[0], { value: { msg: 'hello' }, status: 'fulfilled' });
      assert.strictEqual(ret[1].status, 'rejected');
      assert(/UNKNOWN: foo/.test(ret[1].reason));
    });

    it('should call all clients (all with error)', async () => {
      let pingTimes = 0;
      host.addService((grpcDescriptor as any ).alice.test.TestService.service, {
        async ping(call: ServerWritableStream<root.alice.test.IPing, root.alice.test.IPong>) {
          pingTimes++;
          if (pingTimes === 1) {
            return { msg: call.request.msg };
          }

          throw new Error('foo');
        },
      });
      host.once('error', () => {});

      manager = new Manager({ dirs: { aliceSock: addressDirname }, panel: { panelFirstConnectionTimeout: 1000 } } as Config, 2, loggers.get('manager'));
      await manager.ready();
      // wait second client ready.
      await once(manager, 'newClientReady');

      await assert.rejects(manager.callToAllAvailableClients('ping', [{ msg: 'hello' }], 'all'), {
        message: /2 UNKNOWN: foo/,
      });
    });
  });
});
