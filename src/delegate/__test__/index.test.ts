import assert from 'assert';
import * as common from '#self/test/common';
import { TestClient } from './test-client';
import { NoslatedDelegateService } from '#self/delegate/index';
import path from 'path';

describe(common.testName(__filename), () => {
  let client: TestClient | null;
  let delegate: NoslatedDelegateService | null;

  afterEach(async () => {
    await client?.close();
    delegate?.close();
    client = null;
    delegate = null;
  });

  it('should emit bind event', async () => {
    const clientOnBind = new assert.CallTracker();
    const serverOnBind = new assert.CallTracker();
    // TODO: verify client disconnect event;
    // const clientOnDisconnect = new assert.CallTracker();
    const serverOnDisconnect = new assert.CallTracker();

    delegate = new NoslatedDelegateService();
    delegate.register('foobar');
    delegate.on(
      'bind',
      serverOnBind.calls(cred => {
        assert.strictEqual(cred, 'foobar');
      }, 1)
    );
    delegate.on(
      'disconnect',
      serverOnDisconnect.calls(cred => {
        assert.strictEqual(cred, 'foobar');
      }, 1)
    );
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');
    client.once('bind', clientOnBind.calls(1));

    await new Promise(resolve => {
      client?.once('bind', resolve);
      client?.connect();
    });
    [clientOnBind, serverOnBind].forEach(it => {
      it.verify();
    });

    await new Promise(resolve => {
      delegate?.once('disconnect', resolve);
      client?.close();
    });
    [serverOnDisconnect].forEach(it => {
      it.verify();
    });
  });

  it('should allow preemptive connection', async () => {
    const clientOnBind = new assert.CallTracker();
    const serverOnBind = new assert.CallTracker();
    const serverOnDisconnect = new assert.CallTracker();

    delegate = new NoslatedDelegateService();
    delegate.register('foobar', { preemptive: true });

    // Both 'bind' and 'disconnect' should be emitted once.
    delegate.on(
      'bind',
      serverOnBind.calls(cred => {
        assert.strictEqual(cred, 'foobar');
      }, 1)
    );
    delegate.on(
      'disconnect',
      serverOnDisconnect.calls(cred => {
        assert.strictEqual(cred, 'foobar');
      }, 1)
    );
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');
    client.once('bind', clientOnBind.calls(1));

    // first connection
    await new Promise(resolve => {
      client?.once('bind', resolve);
      client?.connect();
    });

    const client2 = new TestClient(delegate.serverSockPath(), 'foobar');
    client2.once('bind', clientOnBind.calls(1));

    // second connection
    await new Promise(resolve => {
      client2.once('bind', resolve);
      client2.connect();
    });

    // verify 'bind' emitted once.
    [clientOnBind, serverOnBind].forEach(it => {
      it.verify();
    });

    await new Promise(resolve => {
      delegate?.once('disconnect', resolve);
      client2.close();
    });

    // verify 'disconnect' emitted once.
    [serverOnDisconnect].forEach(it => {
      it.verify();
    });
  });

  it('should cancel requests on client disconnected for resetPeer', async () => {
    delegate = new NoslatedDelegateService();
    delegate.register('foobar');
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');

    await new Promise(resolve => {
      client?.once('bind', resolve);
      client?.connect();
    });

    let err: Error;
    try {
      await Promise.all([
        delegate.trigger('foobar', 'foobar', null as any, { timeout: 60_1000 }),
        Promise.resolve().then(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          delegate?.resetPeer('foobar');
        }),
      ]);
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err! != null);
    assert.throws(() => {
      throw err;
    }, /CanonicalCode::CANCELLED/);
  });

  it('should reset requests on client disconnected for peer disconnected', async () => {
    delegate = new NoslatedDelegateService();
    delegate.register('foobar');
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');

    await new Promise(resolve => {
      client?.once('bind', resolve);
      client?.connect();
    });

    let err: Error;
    try {
      await Promise.all([
        delegate.trigger('foobar', 'foobar', null as any, { timeout: 60_1000 }),
        Promise.resolve().then(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          await client?.close();
        }),
      ]);
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err! != null);
    assert.throws(() => {
      throw err;
    }, /CanonicalCode::CONNECTION_RESET/);
  });

  it('should reset requests on client disconnected for client closed', async () => {
    delegate = new NoslatedDelegateService();
    delegate.register('foobar');
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');

    await new Promise(resolve => {
      client?.once('bind', resolve);
      client?.connect();
    });

    let err: Error;
    try {
      await Promise.all([
        delegate.trigger('foobar', 'foobar', null as any, { timeout: 60_1000 }),
        Promise.resolve().then(async () => {
          await new Promise(resolve => setTimeout(resolve, 100));
          client?.close();
        }),
      ]);
    } catch (e) {
      err = e as Error;
    }
    assert.ok(err! != null);
    assert.throws(() => {
      throw err;
    }, /CanonicalCode::CONNECTION_RESET/);
  });

  describe('setDaprAdaptor', () => {
    let delegate: NoslatedDelegateService;
    let oldMod: any;
    let newMod: any;

    before(() => {
      delegate = new NoslatedDelegateService();
    });

    it('should setDaprAdaptor work', async () => {
      const modPath = path.join(common.daprAdaptorDir, 'index');
      const Clz = require(modPath);

      oldMod = new Clz({
        logger: console,
      });

      await oldMod.ready();

      assert(oldMod.isReady);

      delegate.setDaprAdaptor(oldMod);
    });

    it('should close old DaprAdaptor when set new', async () => {
      const modPath = path.join(common.daprAdaptorDir, 'index');
      const Clz = require(modPath);

      newMod = new Clz({
        logger: console,
      });

      await newMod.ready();

      assert(newMod.isReady);

      delegate.setDaprAdaptor(newMod);

      assert(oldMod.isReady === false);
    });

    it('should close DaprAdaptor when close', async () => {
      await delegate.start();
      await delegate.close();
      assert(newMod.isReady === false);
    });
  });
});
