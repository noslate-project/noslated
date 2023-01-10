import assert from 'assert';
import { once } from 'events';
import * as common from '#self/test/common';
import { TestClient } from './test-client';
import { NoslatedDelegateService } from '#self/delegate/index';
import { ResourcePutAction } from '#self/delegate/index';
import { ResourceStub } from '#self/delegate/resource';
import { DefaultNamespaceResolver } from '#self/delegate/namespace';
import { config } from '#self/config';
import fakeTimers, { Clock } from '@sinonjs/fake-timers';
import sinon from 'sinon';

const kTimeout = config.delegate.resourceAcquisitionTimeout;

describe(common.testName(__filename), () => {
  describe('ResourceStub', () => {
    /** @type {fakeTimers.Clock} */
    let clock: Clock;
    afterEach(() => {
      clock?.uninstall();
    });

    it('should acquire shared resources', () => {
      const notification = sinon.stub();
      const end = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('end', end);

      const acq1 = resource.acquire(false, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      const acq2 = resource.acquire(false, 'cred2');
      assert.ok(acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      resource.release(acq1.token);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      resource.release(acq2.token);
      assert.ok(!resource.isActive);
      assert.strictEqual(notification.callCount, 0);
      assert.strictEqual(end.callCount, 1);
    });

    it('should acquire exclusive resources', () => {
      const notification = sinon.stub();
      const end = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('end', end);

      const acq1 = resource.acquire(true, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      const acq2 = resource.acquire(true, 'cred2');
      assert.ok(!acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      resource.release(acq1.token);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      assert.strictEqual(notification.callCount, 1);
      assert.deepStrictEqual(notification.args[0][0], [[acq2.token, 'cred2']]);
      resource.release(acq2.token);
      assert.ok(!resource.isActive);
      assert.strictEqual(notification.callCount, 1);
      assert.strictEqual(end.callCount, 1);
    });

    it('should acquire shared once exclusive releases', () => {
      const notification = sinon.stub();
      const end = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('end', end);

      const acq1 = resource.acquire(true, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      const acq2 = resource.acquire(false, 'cred2');
      assert.ok(!acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      resource.release(acq1.token);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      assert.strictEqual(notification.callCount, 1);
      assert.deepStrictEqual(notification.args[0][0], [[acq2.token, 'cred2']]);
      resource.release(acq2.token);
      assert.ok(!resource.isActive);
      assert.strictEqual(notification.callCount, 1);
    });

    it('should acquire exclusive once shared releases', () => {
      const notification = sinon.stub();
      const end = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('end', end);

      const acq1 = resource.acquire(false, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      const acq2 = resource.acquire(true, 'cred2');
      assert.ok(!acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      resource.release(acq1.token);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      assert.strictEqual(notification.callCount, 1);
      assert.deepStrictEqual(notification.args[0][0], [[acq2.token, 'cred2']]);
      resource.release(acq2.token);
      assert.ok(!resource.isActive);
      assert.strictEqual(notification.callCount, 1);
    });

    it('should automatically release shared resource once timeout', () => {
      clock = sinon.useFakeTimers() as any;
      const notification = sinon.stub();
      const end = sinon.stub();
      const timeout = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('timeout', timeout);
      resource.on('end', end);

      const acq1 = resource.acquire(false, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      const acq2 = resource.acquire(true, 'cred2');
      assert.ok(!acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);

      clock.tick(kTimeout);
      assert.strictEqual(timeout.callCount, 1);
      assert.deepStrictEqual(timeout.args[0][0], [[acq1.token, 'cred1']]);

      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);
      assert.ok(resource.activeTokens.includes(acq2.token));

      clock.tick(kTimeout);
      assert.strictEqual(timeout.callCount, 2);
      assert.deepStrictEqual(timeout.args[1][0], [[acq2.token, 'cred2']]);
    });

    it('should automatically release exclusive resource once timeout', () => {
      clock = sinon.useFakeTimers() as any;
      const notification = sinon.stub();
      const end = sinon.stub();
      const timeout = sinon.stub();
      const resource = new ResourceStub('foo');
      resource.on('notification', notification);
      resource.on('timeout', timeout);
      resource.on('end', end);

      const acq1 = resource.acquire(true, 'cred1');
      assert.ok(acq1.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      const acq2 = resource.acquire(false, 'cred2');
      assert.ok(!acq2.acquired);
      assert.ok(resource.isActive);
      assert.ok(resource.exclusive);

      clock.tick(kTimeout);
      assert.strictEqual(timeout.callCount, 1);
      assert.deepStrictEqual(timeout.args[0][0], [[acq1.token, 'cred1']]);

      assert.ok(resource.isActive);
      assert.ok(!resource.exclusive);
      assert.ok(resource.activeTokens.includes(acq2.token));

      clock.tick(kTimeout);
      assert.strictEqual(timeout.callCount, 2);
      assert.deepStrictEqual(timeout.args[1][0], [[acq2.token, 'cred2']]);
    });
  });

  describe('basic operations', () => {
    let client: TestClient | null;
    let delegate: NoslatedDelegateService | null;
    afterEach(async () => {
      await client?.close();
      delegate?.close();
      client = null;
      delegate = null;
    });

    const cred = 'foobar';
    const resourceId = 'res-1';

    it('should acquire and release resources', async () => {
      const resolver = new DefaultNamespaceResolver();
      delegate = new NoslatedDelegateService({
        namespaceResolver: resolver,
      } as any);
      delegate.register(cred);
      delegate.start();

      client = new TestClient(delegate.serverSockPath(), cred);

      const bindFuture = once(client, 'bind');
      client.connect();
      await bindFuture;

      let successOrAcquired;
      let token;
      {
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.ACQUIRE_SH, '');
        [{ successOrAcquired, token }] = await resultFuture;
        assert.strictEqual(successOrAcquired, true);
        const stub = resolver.resolve(cred).resources.get(resourceId);
        assert.ok(stub?.activeTokens.includes(token));
      }

      {
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.RELEASE, token);
        [{ successOrAcquired }] = await resultFuture;
        assert.strictEqual(successOrAcquired, true);
        // released resource should have been collected.
        assert(!resolver.resolve(cred).resources.has(resourceId));
      }
    });

    it('should publish resource notifications', async () => {
      delegate = new NoslatedDelegateService();
      delegate.register(cred);
      delegate.start();

      client = new TestClient(delegate.serverSockPath(), cred);

      const bindFuture = once(client, 'bind');
      client.connect();
      await bindFuture;

      let successOrAcquired;
      let token;
      {
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        [{ successOrAcquired, token }] = await resultFuture;
        assert.strictEqual(successOrAcquired, true);
      }

      let token2;
      {
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        [{ successOrAcquired, token: token2 }] = await resultFuture;
        assert.strictEqual(successOrAcquired, false); // failed to put resource, notification registered.
      }
      {
        const notificationFuture = once(client, 'resourceNotification');
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.RELEASE, token);
        await resultFuture;
        const [[notificationResourceId, notificationToken]] =
          await notificationFuture;
        assert.strictEqual(notificationResourceId, resourceId);
        assert.strictEqual(notificationToken, token2);
      }
      {
        // release resources
        const resultFuture = once(client, 'resourcePut');
        client.resourcePut(resourceId, ResourcePutAction.RELEASE, token2);
        await resultFuture;
      }
    });
  });

  describe('multiple clients', () => {
    let clients: TestClient[] = [];
    let delegate: NoslatedDelegateService | null;
    /** @type {fakeTimers.Clock} */
    let clock: Clock;
    afterEach(async () => {
      clock?.uninstall();
      await Promise.all(clients.map(it => it.close()));
      delegate?.close();
      clients = [];
      delegate = null;
    });

    const cred1 = 'foobar1';
    const cred2 = 'foobar2';
    const resourceId = 'res-1';

    it('should acquire and release resources', async () => {
      const resolver = new DefaultNamespaceResolver();
      delegate = new NoslatedDelegateService({
        namespaceResolver: resolver,
      } as any);
      delegate.start();

      delegate.register(cred1);
      const client1 = new TestClient(delegate.serverSockPath(), cred1);
      clients.push(client1);
      delegate.register(cred2);
      const client2 = new TestClient(delegate.serverSockPath(), cred2);
      clients.push(client2);

      const bindFuture = Promise.all([
        once(client1, 'bind'),
        once(client2, 'bind'),
      ]);
      client1.connect();
      client2.connect();
      await bindFuture;

      let successOrAcquired;
      let token;
      {
        const resultFuture = once(client1, 'resourcePut');
        client1.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        [{ successOrAcquired, token }] = await resultFuture;
        assert.strictEqual(successOrAcquired, true);
        const stub = resolver.resolve(cred1).resources.get(resourceId);
        assert.ok(stub?.activeTokens.includes(token));
      }
      {
        const resultFuture = once(client2, 'resourcePut');
        client2.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        const [{ successOrAcquired }] = await resultFuture;
        assert.strictEqual(successOrAcquired, false); // failed to put resource, notification registered.
      }

      {
        const notificationFuture = once(client2, 'resourceNotification');
        // force client1 to exit without releasing;
        client1.close();

        const [[notificationResourceId]] = await notificationFuture;
        assert.strictEqual(notificationResourceId, resourceId);
      }
      client2.close();
      await once(resolver.resolve(cred1).resources.get(resourceId)!, 'end');
    });

    it('should release resources when timed out', async () => {
      clock = fakeTimers.install({
        toFake: ['setTimeout'],
      });
      const resolver = new DefaultNamespaceResolver();
      delegate = new NoslatedDelegateService({
        namespaceResolver: resolver,
      } as any);
      delegate.start();

      delegate.register(cred1);
      const client1 = new TestClient(delegate.serverSockPath(), cred1);
      clients.push(client1);
      delegate.register(cred2);
      const client2 = new TestClient(delegate.serverSockPath(), cred2);
      clients.push(client2);

      const bindFuture = Promise.all([
        once(client1, 'bind'),
        once(client2, 'bind'),
      ]);
      client1.connect();
      client2.connect();
      await bindFuture;

      let successOrAcquired;
      let token;
      {
        const resultFuture = once(client1, 'resourcePut');
        client1.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        [{ successOrAcquired, token }] = await resultFuture;
        assert.ok(successOrAcquired);
        const stub = resolver.resolve(cred1).resources.get(resourceId);
        assert.ok(stub?.activeTokens.includes(token));
      }
      let token2;
      {
        const resultFuture = once(client2, 'resourcePut');
        client2.resourcePut(resourceId, ResourcePutAction.ACQUIRE_EX, '');
        [{ successOrAcquired, token: token2 }] = await resultFuture;
        assert.strictEqual(successOrAcquired, false); // failed to put resource, notification registered.
      }

      {
        const notificationFuture = once(client2, 'resourceNotification');
        await clock.tickAsync(10_000);

        const [[notificationResourceId, notificationToken]] =
          await notificationFuture;
        assert.strictEqual(notificationResourceId, resourceId);
        assert.strictEqual(notificationToken, token2);
      }

      {
        client2.once('resourceNotification', () => {
          assert.fail('unreachable');
        });
        const resultFuture = once(client1, 'resourcePut');
        client1.resourcePut(resourceId, ResourcePutAction.RELEASE, token);
        await resultFuture;
      }
      client2.close();
      await once(resolver.resolve(cred1).resources.get(resourceId)!, 'end');
    });
  });
});
