import { WorkerTrafficStatsEvent } from '#self/control_plane/events';
import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import assert from 'assert';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), () => {
  const env = new DefaultEnvironment();

  describe('reservation', () => {
    it('should bootstrap provisional workers', async () => {
      const eventBus = env.control._ctx.getInstance('eventBus');
      const stateManager = env.control._ctx.getInstance('stateManager');

      await env.agent.setFunctionProfile(
        [
          {
            name: 'aworker_echo',
            runtime: 'aworker',
            url: `file://${baselineDir}/aworker_echo`,
            sourceFile: 'index.js',
            signature: 'md5:234234',
            worker: {
              reservationCount: 1,
            },
          },
        ],
        'WAIT'
      );

      await eventBus.publish(new WorkerTrafficStatsEvent([]));
      const broker = stateManager.getBroker('aworker_echo', false);
      assert(broker);
      assert.strictEqual(broker.activeWorkerCount, 1);
    });
  });
});
