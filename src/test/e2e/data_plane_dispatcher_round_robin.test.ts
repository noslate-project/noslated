import * as common from '#self/test/common';
import { findResponseHeader } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import assert from 'assert';
import { WorkerStatusReportEvent } from '#self/control_plane/events';
import { bufferFromStream } from '#self/lib/util';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);
  const env = new DefaultEnvironment();

  it('dispatch with round robin dispatcher', async () => {
    const profile: AworkerFunctionProfile = {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 2,
        dispatchMode: 'round-robin',
      },
    };

    await env.agent.setFunctionProfile([profile]);
    const report1 = await env.control['_eventBus'].once(
      WorkerStatusReportEvent
    );
    const report2 = await env.control['_eventBus'].once(
      WorkerStatusReportEvent
    );

    const resp1 = await env.agent.invoke('aworker_echo', Buffer.from('foobar'));
    const id1 = findResponseHeader(resp1, 'x-noslate-worker-id')?.[1];

    const resp2 = await env.agent.invoke('aworker_echo', Buffer.from('foobar'));
    const id2 = findResponseHeader(resp2, 'x-noslate-worker-id')?.[1];

    assert.strictEqual(id1, report1.data.name);
    assert.strictEqual(id2, report2.data.name);

    // drain the request.
    await bufferFromStream(resp1);
    await bufferFromStream(resp2);
  });
});
