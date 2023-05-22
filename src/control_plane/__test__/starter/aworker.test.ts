import assert from 'assert';
import fs from 'fs';
import path from 'path';
import _ from 'lodash';
import mm from 'mm';
import * as common from '#self/test/common';
import { config } from '#self/config';
import { Aworker } from '#self/control_plane/starter/index';
import { Turf } from '#self/lib/turf';
import * as testUtil from '#self/test/util';
import { TurfContainerStates, TurfProcess } from '#self/lib/turf/types';
import { sleep } from '#self/lib/util';
import { startTurfD, stopTurfD } from '#self/test/turf';
import { TurfContainerManager } from '#self/control_plane/container/turf_container_manager';
import { DependencyContext } from '#self/lib/dependency_context';
import { EventBus } from '#self/lib/event-bus';
import {
  ContainerReconciledEvent,
  PlatformEnvironsUpdatedEvent,
  WorkerStoppedEvent,
} from '#self/control_plane/events';
import { StarterContext } from '#self/control_plane/starter/base';
import { ResourceManager } from '#self/control_plane/resource_manager';
import { systemClock } from '#self/lib/clock';
import { ContainerReconciler } from '#self/control_plane/container/reconciler';
import sinon from 'sinon';
import { TestContainer, TestContainerManager } from '../test_container_manager';
import { once } from 'events';

const conditionalDescribe =
  process.platform === 'darwin' ? describe.skip : describe;

type TestContext = StarterContext & {
  containerReconciler: ContainerReconciler;
};

function getTestContext() {
  const ctx = new DependencyContext<TestContext>();
  ctx.bindInstance('config', config);
  ctx.bindInstance('clock', systemClock);
  ctx.bindInstance(
    'eventBus',
    new EventBus([
      PlatformEnvironsUpdatedEvent,
      WorkerStoppedEvent,
      ContainerReconciledEvent,
    ])
  );
  ctx.bind('containerReconciler', ContainerReconciler);
  ctx.bind('resourceManager', ResourceManager);

  return ctx;
}

conditionalDescribe(common.testName(__filename), function () {
  this.timeout(10_000);

  describe('#constructor()', () => {
    let ctx: DependencyContext<TestContext>;
    let turf: Turf;
    let aworker: Aworker;

    beforeEach(async () => {
      mm(config.dirs, 'noslatedSock', testUtil.TMP_DIR());
      mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');
      startTurfD();

      ctx = getTestContext();
      ctx.bind('containerManager', TurfContainerManager);
      await ctx.bootstrap();
      turf = (ctx.getInstance('containerManager') as TurfContainerManager)
        .client;

      aworker = new Aworker(ctx);
    });

    afterEach(async function () {
      this.timeout(10_000);
      await aworker.close();

      mm.restore();
      sinon.restore();
      await ctx.dispose();
      fs.rmSync(testUtil.TMP_DIR(), { recursive: true });
      stopTurfD();
    });

    it('should start seed', async () => {
      await aworker.ready();

      assert.deepStrictEqual(
        _.pick(await turf.state(Aworker.SEED_CONTAINER_NAME), [
          'name',
          'state',
          'status',
        ]),
        {
          name: Aworker.SEED_CONTAINER_NAME,
          state: TurfContainerStates.forkwait,
          status: '0',
        }
      );
    });

    it('should keep seed alive', async () => {
      await aworker.ready();

      let psData = await turf.ps();
      {
        const seed = psData.find(
          (it: TurfProcess) =>
            it.name === Aworker.SEED_CONTAINER_NAME &&
            it.status === TurfContainerStates.forkwait
        );
        assert(seed);
        process.kill(seed.pid, 'SIGKILL');
      }

      // wait seed ready
      await sleep(2000);

      psData = await turf.ps();

      assert(
        psData.some(
          (it: TurfProcess) =>
            it.name === Aworker.SEED_CONTAINER_NAME &&
            it.status === TurfContainerStates.forkwait
        )
      );
    });
  });

  describe('seed backing off', () => {
    let ctx: DependencyContext<TestContext>;
    let containerManager: TestContainerManager;
    let aworker: Aworker;

    beforeEach(async () => {
      mm(config.dirs, 'noslatedSock', testUtil.TMP_DIR());
      mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');

      ctx = getTestContext();
      containerManager = new TestContainerManager(systemClock);
      ctx.bindInstance('containerManager', containerManager);
      await ctx.bootstrap();

      aworker = new Aworker(ctx);
    });

    afterEach(async () => {
      await aworker.close();
      mm.restore();
      sinon.restore();
      await ctx.dispose();
      fs.rmSync(testUtil.TMP_DIR(), { recursive: true });
    });

    it('should back off when seed failed to start', async () => {
      /** do not await ready */
      aworker.ready();

      let lastDuration = -1;
      /** 0, 1000, 1900 */
      for (let i = 0; i < 3; i++) {
        const start = Date.now();
        const [seed] = (await once(containerManager, 'spawn')) as [
          TestContainer
        ];
        const duration = Date.now() - start;
        assert.ok(
          duration > lastDuration,
          `duration(${duration}) > last duration(${lastDuration})`
        );
        lastDuration = duration;
        await seed.stop();
      }
    });
  });

  describe('#start()', () => {
    let ctx: DependencyContext<TestContext>;
    let containerManager: TestContainerManager;
    let aworker: Aworker;

    beforeEach(async () => {
      mm(config.dirs, 'noslatedSock', testUtil.TMP_DIR());
      mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');

      ctx = getTestContext();
      containerManager = new TestContainerManager(systemClock);
      ctx.bindInstance('containerManager', containerManager);
      await ctx.bootstrap();

      aworker = new Aworker(ctx);

      const readyFuture = aworker.ready();
      const [seed] = (await once(containerManager, 'spawn')) as [TestContainer];
      seed.updateStatus(TurfContainerStates.forkwait);
      await readyFuture;
    });

    afterEach(async () => {
      await aworker.close();
      mm.restore();
      sinon.restore();
      await ctx.dispose();
      fs.rmSync(testUtil.TMP_DIR(), { recursive: true });
    });

    it('should start with seed', async () => {
      const bundlePath = path.join(
        testUtil.TMP_DIR(),
        'bundles',
        Aworker.SEED_CONTAINER_NAME
      );
      fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });
      fs.writeFileSync(path.join(bundlePath, 'code', 'index.js'), '');

      const spy = sinon.spy(containerManager, 'spawn');
      await aworker.start(
        'foo.sock',
        'foo',
        'bar',
        {
          name: 'foo',
          sourceFile: 'index.js',
          runtime: 'aworker',
        } as any,
        bundlePath,
        {}
      );

      const args = spy.args[0];
      assert.strictEqual(args[0], 'foo');
      assert.strictEqual(args[1], bundlePath);
      assert.strictEqual(args[3]?.seed, Aworker.SEED_CONTAINER_NAME);
    });

    it('should start function with seed disabled', async () => {
      const bundlePath = path.join(
        testUtil.TMP_DIR(),
        'bundles',
        Aworker.SEED_CONTAINER_NAME
      );
      fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });
      fs.writeFileSync(path.join(bundlePath, 'code', 'index.js'), '');

      const spy = sinon.spy(containerManager, 'spawn');

      await aworker.start(
        'foo.sock',
        'foo',
        'bar',
        {
          name: 'foo',
          sourceFile: 'index.js',
          runtime: 'aworker',
          worker: {
            disableSeed: true,
          },
        } as any,
        bundlePath,
        {}
      );

      const args = spy.args[0];
      assert.strictEqual(args[0], 'foo');
      assert.strictEqual(args[1], bundlePath);
      assert.strictEqual(args[3]?.seed, undefined);
    });

    it('should start when seed is unavailable', async () => {
      const seed = containerManager.getContainer(Aworker.SEED_CONTAINER_NAME)!;
      await seed.stop();
      await containerManager.reconcileContainers();

      const bundlePath = path.join(
        testUtil.TMP_DIR(),
        'bundles',
        Aworker.SEED_CONTAINER_NAME
      );
      fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });
      fs.writeFileSync(path.join(bundlePath, 'code', 'index.js'), '');

      const spy = sinon.spy(containerManager, 'spawn');

      // Seed is not available to be forked.
      assert.notStrictEqual(seed.status, TurfContainerStates.forkwait);
      await aworker.start(
        'foo.sock',
        'foo',
        'bar',
        {
          name: 'foo',
          sourceFile: 'index.js',
          runtime: 'aworker',
        } as any,
        bundlePath,
        {}
      );

      const args = spy.args[0];
      assert.strictEqual(args[0], 'foo');
      assert.strictEqual(args[1], bundlePath);
      assert.strictEqual(args[3]?.seed, undefined);
    });
  });
});
