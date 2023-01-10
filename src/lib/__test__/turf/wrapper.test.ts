import assert from 'assert';
import path from 'path';
import { config } from '#self/config';
import * as common from '#self/test/common';
import { Turf, TurfContainerStates } from '#self/lib/turf/wrapper';
import { FIXTURES_DIR } from '#self/test/util';
import { startTurfD, stopTurfD } from '#self/test/turf';

const simpleSandbox = path.resolve(FIXTURES_DIR, 'sandbox_simple');
const containerName = 'foobar';

describe(common.testName(__filename), () => {
  let turf: Turf;
  beforeEach(async () => {
    await startTurfD();
    turf = new Turf(config.turf.bin, config.turf.socketPath);
    await turf.connect();
  });
  afterEach(async () => {
    await turf.close();
    await stopTurfD();
  });

  it('ps', async () => {
    await turf.create(containerName, simpleSandbox);
    {
      const result = await turf.ps();
      assert.strictEqual(result.length, 1);
      const [item] = result;
      assert.strictEqual(item.name, 'foobar');
      assert.strictEqual(item.pid, 0);
      assert.strictEqual(item.status, TurfContainerStates.init);
    }

    let pid;
    await turf.start(containerName);
    {
      const result = await turf.ps();
      assert.strictEqual(result.length, 1);
      const [item] = result;
      assert.strictEqual(item.name, 'foobar');
      assert.strictEqual(item.status, TurfContainerStates.running);
      pid = item.pid;
    }

    process.kill(pid);
    {
      const result = await turf.ps();
      assert.strictEqual(result.length, 1);
      const [item] = result;
      assert.strictEqual(item.name, 'foobar');
      assert.strictEqual(item.pid, pid);
      assert.strictEqual(item.status, TurfContainerStates.stopped);
    }
  });

  it('state', async () => {
    await turf.create(containerName, simpleSandbox);
    await assert.rejects(turf.state(containerName), /sandbox foobar not found/);

    let pid;
    await turf.start(containerName);
    {
      const result = await turf.state(containerName);
      assert.strictEqual(result?.name, 'foobar');
      assert.strictEqual(result.state, TurfContainerStates.running);
      pid = result.pid;
    }

    process.kill(pid);
    {
      const result = await turf.state(containerName);
      assert.strictEqual(result?.name, 'foobar');
      assert.strictEqual(result.state, TurfContainerStates.stopped);
      assert.strictEqual(result.pid, pid);
    }
  });
});
