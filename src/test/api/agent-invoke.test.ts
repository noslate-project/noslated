import assert from 'assert';

import * as common from '../common';
import { bufferFromStream } from '#self/lib/util';
import { TriggerResponse, Metadata } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { DefaultEnvironment } from '../env/environment';
import { once } from 'events';

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

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new DefaultEnvironment();

  it('invoke readable', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

    const readable = Readable.from([Buffer.from('foobar')]);
    const response = await env.agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);
    const buffer = await bufferFromStream(response);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');
  });

  it('invoke duplex stream', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

    const readable = new Readable({
      read() {},
      destroy() {},
    });
    let pushCount = 0;
    const pushReadable = () => {
      if (pushCount >= 3) {
        return;
      }
      pushCount++;
      readable.push(Buffer.from('foobar'));
      if (pushCount === 3) {
        readable.push(null);
      }
    };
    pushReadable();

    const response = await env.agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);

    const bufs: Buffer[] = [];
    response.on('data', chunk => {
      bufs.push(chunk);
      pushReadable();
    });
    await once(response, 'end');
    assert.strictEqual(
      Buffer.concat(bufs).toString('utf8'),
      'foobarfoobarfoobar'
    );
  });

  it('destroy request stream', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

    const readable = new Readable({
      read() {},
      destroy(err, callback) {
        callback(err);
      },
    });
    readable.push(Buffer.from('foobar'));

    const response = await env.agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);

    response.on('data', () => {
      readable.destroy(new Error('foobar'));
    });

    await assert.rejects(
      once(response, 'end'),
      /CANCELLED: Cancelled on client/
    );
  });

  it('destroy response stream', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

    const readable = new Readable({
      read() {},
      destroy() {},
    });
    readable.push(Buffer.from('foobar'));

    const response = await env.agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);

    response.on('data', () => {
      response.destroy(new Error('foo'));
    });
    await assert.rejects(once(response, 'end'), /foo/);
  });

  it('invoke with malfunctioning readable in immediate', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

    const readable = new Readable({
      read() {
        this.destroy(new Error('foobar'));
      },
    });

    await assert.rejects(
      env.agent.invoke(item.name, readable),
      /CANCELLED: Cancelled on client/
    );
  });

  // TODO(kaidi.zkd): readable.destroy 之后，服务的识别成正常的 `end` 事件了
  it.skip('invoke with malfunctioning readable in async', async () => {
    await env.agent.setFunctionProfile([item.profile] as any);

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
