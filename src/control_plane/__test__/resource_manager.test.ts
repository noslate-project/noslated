import { promises as fs } from 'fs';
import sinon from 'sinon';
import assert from 'assert';
import { config } from '#self/config';
import { DependencyContext } from '#self/lib/dependency_context';
import { createTestClock, TestClock, testName } from '#self/test/common';
import {
  ResourceManager,
  ResourceManagerContext,
} from '#self/control_plane/resource_manager';
import { EventBus } from '#self/lib/event-bus';
import { WorkerStoppedEvent } from '../events';
import { workerLogPath } from '../container/container_manager';

describe(testName(__filename), () => {
  let ctx: DependencyContext<ResourceManagerContext>;
  let clock: TestClock;
  let manager: ResourceManager;
  beforeEach(async () => {
    ctx = new DependencyContext();
    ctx.bindInstance('config', config);
    clock = createTestClock({
      shouldAdvanceTime: true,
    });
    ctx.bindInstance('clock', clock);
    ctx.bindInstance('eventBus', new EventBus([WorkerStoppedEvent]));
    manager = new ResourceManager(ctx);
    await manager.ready();
  });

  afterEach(async () => {
    await manager.close();
    await ctx.dispose();
    clock.uninstall();
    sinon.restore();
  });

  it('should remove log dir on WorkerStoppedEvent', async () => {
    const spyFs = sinon.spy(fs, 'rm');
    await ctx.getInstance('eventBus').publish(
      new WorkerStoppedEvent({
        emitExceptionMessage: undefined,
        state: null,
        runtimeType: 'aworker',
        functionName: 'foobar',
        workerName: 'worker-foobar',
      })
    );

    assert.strictEqual(spyFs.callCount, 0);

    const config = ctx.getInstance('config');
    clock.tick(config.worker.gcLogDelay + 1000);
    assert.strictEqual(spyFs.callCount, 1);
    assert.strictEqual(
      spyFs.args[0][0],
      workerLogPath(config.logger.dir, 'worker-foobar')
    );
  });
});
