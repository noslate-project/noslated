import * as common from '#self/test/common';
import { findResponseHeader } from '#self/test/util';
import { DefaultEnvironment } from '#self/test/env/environment';
import { baselineDir } from '#self/test/common';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import assert from 'assert';
import {
  RequestQueueingEvent,
  WorkerStatusReportEvent,
} from '#self/control_plane/events';
import { bufferFromStream } from '#self/lib/util';
import _ from 'lodash';
import { Readable } from 'stream';

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

  it('dispatch with concurrency limit', async () => {
    const profile: AworkerFunctionProfile = {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 2,
        dispatchMode: 'round-robin',
        /** concurrency limit is 2 * 1 = 2 */
        replicaCountLimit: 2,
        maxActivateRequests: 1,
      },
    };

    await env.agent.setFunctionProfile([profile]);
    const report1 = await env.control['_eventBus'].once(
      WorkerStatusReportEvent
    );
    const report2 = await env.control['_eventBus'].once(
      WorkerStatusReportEvent
    );

    const requests = _.times(3).map(() => new Readable({ read() {} }));
    const respFutures = _.times(3).map(async idx => {
      const resp = await env.agent.invoke('aworker_echo', requests[idx], {
        method: 'POST',
      });
      return resp;
    });

    // One request had been queued.
    await env.control['_eventBus'].once(RequestQueueingEvent);
    requests.forEach(it => it.push(null));

    const resps = await Promise.all(respFutures);
    const ids = resps.map(
      it => findResponseHeader(it, 'x-noslate-worker-id')?.[1]
    );

    assert.deepStrictEqual(ids, [
      report1.data.name,
      report2.data.name,
      report1.data.name,
    ]);

    // drain the requests.
    await Promise.all(resps.map(it => bufferFromStream(it)));
  });
});
