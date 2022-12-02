import assert from 'assert';

import * as common from '../common';
import { bufferFromStream } from '#self/lib/util';
import { TriggerResponse, Metadata } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { DefaultEnvironment } from '../env/environment';

const item = {
  name: 'node_worker_echo',
  profile: {
    name: 'node_worker_echo',
    runtime: 'nodejs',
    url: `file:///${common.baselineDir}/node_worker_echo`,
    handler: 'index.handler',
    signature: 'md5:234234',
  },
};

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new DefaultEnvironment();

  it('invoke readable', async () => {
    await env.agent.setFunctionProfile([ item.profile ] as any);

    const readable = Readable.from([ Buffer.from('foobar') ]);
    const response = await env.agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);
    const buffer = await bufferFromStream(response);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');
  });

  it('invoke with malfunctioning readable in immediate', async () => {
    await env.agent.setFunctionProfile([ item.profile ] as any);

    const readable = new Readable({
      read() {
        this.destroy(new Error('foobar'));
      },
    });

    let err;
    try {
      await env.agent.invoke(item.name, readable);
    } catch (e) {
      err = e;
    }
    assert.ok(err !== undefined);
    assert.ok((err as Error).message.match(/foobar/));
  });

  // TODO: serialization error, performance cost on iterating.
  it.skip('invoke with mis-typing metadata', async () => {
    await env.agent.setFunctionProfile([ item.profile ] as any);

    const fatalCases = [
      'foo',
      [ 'foo' ],
      [ 'foo', null ],
    ];
    for (const esac of fatalCases) {
      let err: Error;
      try {
        const stream = await env.agent.invoke(item.name, Buffer.from('foo'), {
          headers: esac,
        } as any);
        stream.destroy();
      } catch (e) {
        err = e as Error;
      }
      assert.throws(() => { throw err; }, /Expect a key value pair/);
    }

    const tolerableCases = [
      [[ 'foo', null ]],
      [[ null, 1 ]],
    ];
    for (const esac of tolerableCases) {
      const stream = await env.agent.invoke(item.name, Buffer.from('foo'), {
        headers: esac,
      } as any);
      stream.destroy();
    }
  });

  // TODO(kaidi.zkd): readable.destroy 之后，服务的识别成正常的 `end` 事件了
  it.skip('invoke with malfunctioning readable in async', async () => {
    await env.agent.setFunctionProfile([ item.profile ] as any);

    const readable = new Readable({
      read() {},
    });
    const response = await env.agent.invoke(item.name, readable);
    const err = await new Promise(resolve => {
      response.on('error', e => {
        resolve(e);
      });
      readable.destroy(new Error('foobar'));
    });
    /**
     * Error may be any client error as the readable error was emitted to
     * client.
     */
    assert.ok((err as Error).message.match(/Timeout/i) == null);
  });
});
