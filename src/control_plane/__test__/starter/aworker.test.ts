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
import { ControlPlane } from '#self/control_plane/control_plane';
import { TurfContainerStates, TurfProcess } from '#self/lib/turf/types';
import FakeTimers from '@sinonjs/fake-timers';
import { sleep } from '#self/lib/util';
import { startTurfD, stopTurfD } from '#self/test/turf';

const conditionalDescribe =
  process.platform === 'darwin' ? describe.skip : describe;

describe(common.testName(__filename), function () {
  this.timeout(10000);

  const dummyPlane: any = {
    platformEnvironmentVariables: {},
  };

  let turf: Turf;

  beforeEach(async () => {
    mm(config.dirs, 'noslatedSock', testUtil.TMP_DIR());
    mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');
    startTurfD();
    turf = new Turf(config.turf.bin, config.turf.socketPath);
    await turf.connect();
    dummyPlane.turf = turf;
  });

  afterEach(async () => {
    mm.restore();
    fs.rmdirSync(testUtil.TMP_DIR(), { recursive: true });
    await turf.close();
    stopTurfD();
  });

  conditionalDescribe('#constructor()', () => {
    it('should start seed', async () => {
      let aworker;
      try {
        aworker = new Aworker(dummyPlane as any, config);
        await aworker.ready();
        await aworker.waitSeedReady();

        assert.deepStrictEqual(
          _.pick(await turf.state(Aworker.SEED_CONTAINER_NAME), [
            'name',
            'state',
            'status',
          ]),
          {
            name: Aworker.SEED_CONTAINER_NAME,
            state: 'forkwait',
            status: '0',
          }
        );
      } finally {
        await aworker?.close();
      }
    });
  });

  conditionalDescribe('#keepSeedAliveTimer', () => {
    it('seed should keep alive', async () => {
      const aworker = new Aworker(
        dummyPlane as unknown as ControlPlane,
        config
      );
      await aworker.ready();
      await aworker.waitSeedReady();

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

      await aworker.close();
    });
  });

  conditionalDescribe('#start()', () => {
    it('should start with seed', async () => {
      let aworker;
      try {
        aworker = new Aworker(dummyPlane as any, config);
        await aworker.ready();
        await aworker.waitSeedReady();

        const bundlePath = path.join(
          testUtil.TMP_DIR(),
          'bundles',
          Aworker.SEED_CONTAINER_NAME
        );
        fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });
        fs.writeFileSync(path.join(bundlePath, 'code', 'index.js'), '');
        mm(turf, 'create', async (...args: any[]) => {
          assert.deepStrictEqual(args, ['foo', bundlePath]);
        });

        mm(turf, 'start', async (...args: any[]) => {
          assert.deepStrictEqual(args, [
            'foo',
            {
              stdout: args[1].stdout,
              stderr: args[1].stderr,
              seed: Aworker.SEED_CONTAINER_NAME,
            },
          ]);
        });

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
      } finally {
        await aworker?.close();
      }
    });

    it('should start without seed', async () => {
      let aworker;
      try {
        mm(Aworker.prototype, 'keepSeedAlive', async function (this: any) {
          // This means we mocked the seed process creation function. No seed process will be spawned in this test case.
          this.logger.info('dummy keeper');
        });

        aworker = new Aworker(dummyPlane as ControlPlane, config);
        await aworker.ready();

        const bundlePath = path.join(
          testUtil.TMP_DIR(),
          'bundles',
          Aworker.SEED_CONTAINER_NAME
        );
        fs.mkdirSync(path.join(bundlePath, 'code'), { recursive: true });
        fs.writeFileSync(path.join(bundlePath, 'code', 'index.js'), '');
        mm(turf, 'create', async (...args: any[]) => {
          assert.deepStrictEqual(args, ['foo', bundlePath]);
        });

        mm(turf, 'start', async (...args: any[]) => {
          assert.deepStrictEqual(args, [
            'foo',
            {
              stdout: args[1].stdout,
              stderr: args[1].stderr,
            },
          ]);
        });

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
      } finally {
        await aworker?.close();
      }
    });
  });
});
