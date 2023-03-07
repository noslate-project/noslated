import { config } from '#self/config';
import {
  ContainerReconciler,
  ReconcilerContext,
} from '#self/control_plane/container/reconciler';
import { DependencyContext } from '#self/lib/dependency_context';
import { createDeferred, Deferred } from '#self/lib/util';
import * as common from '#self/test/common';
import assert from 'assert';
import sinon from 'sinon';
import { TestContainerManager } from '../test_container_manager';

describe(common.testName(__filename), () => {
  let clock: common.TestClock;
  let containerManager: TestContainerManager;
  beforeEach(() => {
    clock = common.createTestClock();
    containerManager = new TestContainerManager(clock);
  });

  afterEach(() => {
    sinon.restore();
    clock.uninstall();
  });

  it('should initiate reconciliation by interval', async () => {
    const stub = sinon.stub(containerManager, 'reconcileContainers');
    let deferred!: Deferred<void>;
    stub.callsFake(() => {
      deferred = createDeferred<void>();
      return deferred.promise;
    });

    const ctx = new DependencyContext<ReconcilerContext>();
    ctx.bindInstance('clock', clock);
    ctx.bindInstance('config', config);
    ctx.bindInstance('containerManager', containerManager);

    const reconciler = new ContainerReconciler(ctx);
    reconciler.ready();

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);

    deferred.resolve();
    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);

    reconciler.close();
    await clock.tickAsync(config.turf.reconcilingInterval);
    deferred.resolve();
    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);
  });

  it('should immediately reconcile once requested', async () => {
    const stub = sinon.stub(containerManager, 'reconcileContainers');
    let deferred!: Deferred<void>;
    stub.callsFake(() => {
      deferred = createDeferred<void>();
      return deferred.promise;
    });

    const ctx = new DependencyContext<ReconcilerContext>();
    ctx.bindInstance('clock', clock);
    ctx.bindInstance('config', config);
    ctx.bindInstance('containerManager', containerManager);

    const reconciler = new ContainerReconciler(ctx);
    reconciler.ready();

    await clock.tickAsync(config.turf.reconcilingInterval / 2);
    assert.strictEqual(stub.callCount, 0);
    const reconcileFuture = reconciler.reconcile();

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);

    deferred.resolve();
    await reconcileFuture;
    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);

    reconciler.close();
  });
});
