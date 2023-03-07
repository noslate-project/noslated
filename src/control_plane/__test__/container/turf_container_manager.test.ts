import path from 'path';
import fs from 'fs';
import { config } from '#self/config';
import {
  TurfContainer,
  TurfContainerManager,
} from '#self/control_plane/container/turf_container_manager';
import { ConfigContext } from '#self/control_plane/deps';
import { DependencyContext } from '#self/lib/dependency_context';
import * as common from '#self/test/common';
import { startTurfD, stopTurfD } from '#self/test/turf';
import { FIXTURES_DIR, TMP_DIR, unlinkTmpDir } from '#self/test/util';
import assert from 'assert';
import { TurfContainerStates } from '#self/lib/turf';
import { sleep } from '#self/lib/util';
import { TurfCode } from '#self/lib/turf/types';

const simpleSandbox = path.resolve(FIXTURES_DIR, 'sandbox_simple');
const specText = fs.readFileSync(
  path.join(simpleSandbox, 'config.json'),
  'utf8'
);

describe(common.testName(__filename), function () {
  this.timeout(30_000);

  let turfContainerManager: TurfContainerManager;
  let bundlePath: string;
  beforeEach(async () => {
    startTurfD();
    const ctx = new DependencyContext<ConfigContext>();
    ctx.bindInstance('config', config);
    turfContainerManager = new TurfContainerManager(ctx);
    await turfContainerManager.ready();

    bundlePath = path.join(TMP_DIR(), 'sandbox_simple');
    fs.cpSync(simpleSandbox, bundlePath, {
      recursive: true,
    });
  });

  afterEach(async () => {
    await turfContainerManager.close();
    await stopTurfD();
    unlinkTmpDir();
  });

  describe('spawn', () => {
    it('should spawn containers', async () => {
      const container = await turfContainerManager.spawn(
        'container1',
        bundlePath,
        JSON.parse(specText)
      );
      assert.ok(container instanceof TurfContainer);
      {
        assert.strictEqual(
          turfContainerManager.getContainer('container1'),
          container
        );
        const list = turfContainerManager.list();
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0], container);
      }

      await turfContainerManager.reconcileContainers();
      assert.strictEqual(typeof container.pid, 'number');
      assert.ok(container.pid! >= 0);

      await container.stop();
      await waitContainer(container, TurfContainerStates.stopped);
      const state = await container.terminated;
      assert.ok(state != null);
      assert.strictEqual(state.pid, container.pid);
      {
        assert.strictEqual(
          turfContainerManager.getContainer('container1'),
          null
        );
        const list = turfContainerManager.list();
        assert.strictEqual(list.length, 0);
      }

      // the container is deleted.
      await assert.rejects(
        turfContainerManager.client.state('container1'),
        /sandbox container1 not found/
      );
    });

    it('when failed to create container', async () => {
      const spec = JSON.parse(specText);
      spec.process.args = ['non-exist-bin'];
      await assert.rejects(
        turfContainerManager.spawn('container1', bundlePath, spec),
        {
          name: 'TurfError',
          code: TurfCode.ENOENT,
        }
      );
      {
        assert.strictEqual(
          turfContainerManager.getContainer('container1'),
          null
        );
        const list = turfContainerManager.list();
        assert.strictEqual(list.length, 0);
      }

      await assert.rejects(
        turfContainerManager.client.state('container1'),
        /sandbox container1 not found/
      );
    });
  });

  describe('reconcileContainers', () => {
    it('should mark missing container as unknown', async () => {
      const container = new TurfContainer(turfContainerManager, 'container2');
      turfContainerManager['containers'].set('container2', container);

      await turfContainerManager.reconcileContainers();
      assert.strictEqual(container.status, TurfContainerStates.unknown);

      const state = await container.terminated;
      assert.strictEqual(state, null);
    });
  });

  async function waitContainer(
    container: TurfContainer,
    status: TurfContainerStates
  ) {
    while (container.status !== status) {
      await sleep(1000);
      await turfContainerManager.reconcileContainers();
    }
  }
});
