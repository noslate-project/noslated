import { config } from '#self/config';
import {
  ContainerReconciler,
  ReconcilerContext,
} from '#self/control_plane/container/reconciler';
import { ContainerReconciledEvent } from '#self/control_plane/events';
import { DependencyContext } from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';
import { createDeferred, Deferred } from '#self/lib/util';
import * as common from '#self/test/common';
import assert from 'assert';
import sinon from 'sinon';
import { TestContainerManager } from '../test_container_manager';

describe(common.testName(__filename), () => {
  let clock: common.TestClock;
  let containerManager: TestContainerManager;
  let eventBus: EventBus;
  let ctx: DependencyContext<ReconcilerContext>;
  beforeEach(() => {
    clock = common.createTestClock();
    containerManager = new TestContainerManager(clock);
    eventBus = new EventBus([ContainerReconciledEvent]);

    ctx = new DependencyContext();
    ctx.bindInstance('clock', clock);
    ctx.bindInstance('eventBus', eventBus);
    ctx.bindInstance('config', config);
    ctx.bindInstance('containerManager', containerManager);
  });

  afterEach(() => {
    sinon.restore();
    clock.uninstall();
  });

  it('should initiate reconciliation by interval', async () => {
    let eventCount = 0;
    eventBus.subscribe(ContainerReconciledEvent, {
      next() {
        eventCount++;
      },
    });

    const stub = sinon.stub(containerManager, 'reconcileContainers');
    let deferred!: Deferred<void>;
    stub.callsFake(() => {
      deferred = createDeferred<void>();
      return deferred.promise;
    });

    const reconciler = new ContainerReconciler(ctx);
    reconciler.ready();

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);
    // reconciliation is not resolved yet.
    assert.strictEqual(eventCount, 0);

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);
    // reconciliation is not resolved yet.
    assert.strictEqual(eventCount, 0);

    deferred.resolve();
    await clock.tickAsync(1);
    assert.strictEqual(eventCount, 1);

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);
    // reconciliation is not resolved yet.
    assert.strictEqual(eventCount, 1);

    reconciler.close();
    await clock.tickAsync(config.turf.reconcilingInterval);
    deferred.resolve();
    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);
    assert.strictEqual(eventCount, 2);
  });

  it('should immediately reconcile once requested', async () => {
    let eventCount = 0;
    eventBus.subscribe(ContainerReconciledEvent, {
      next() {
        eventCount++;
      },
    });

    const stub = sinon.stub(containerManager, 'reconcileContainers');
    let deferred!: Deferred<void>;
    stub.callsFake(() => {
      deferred = createDeferred<void>();
      return deferred.promise;
    });

    const reconciler = new ContainerReconciler(ctx);
    reconciler.ready();

    await clock.tickAsync(config.turf.reconcilingInterval / 2);
    assert.strictEqual(stub.callCount, 0);
    assert.strictEqual(eventCount, 0);
    const reconcileFuture = reconciler.reconcile();

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 1);
    // reconciliation is not resolved yet.
    assert.strictEqual(eventCount, 0);

    deferred.resolve();
    await reconcileFuture;
    assert.strictEqual(eventCount, 1);

    await clock.tickAsync(config.turf.reconcilingInterval);
    assert.strictEqual(stub.callCount, 2);

    reconciler.close();
  });
});
