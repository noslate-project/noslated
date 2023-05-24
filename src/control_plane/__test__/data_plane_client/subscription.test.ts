import { WorkerTrafficStatsEvent } from '#self/control_plane/events';
import * as common from '#self/test/common';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  this.timeout(10_000);

  const env = new DefaultEnvironment({
    config: common.extendDefaultConfig({
      controlPlane: {
        workerTrafficStatsPullingMs: 1000,
      },
    }),
  });

  it('should regularly emit event WorkerTrafficStatsEvent', async () => {
    const eventBus = env.control['_eventBus'];
    await eventBus.once(WorkerTrafficStatsEvent);
    await eventBus.once(WorkerTrafficStatsEvent);
  });
});
