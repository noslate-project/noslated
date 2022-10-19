import assert from 'assert';

import * as common from '../common';
import { bufferFromStream } from '#self/lib/util';
import { startTurfD, stopTurfD } from '#self/lib/turf';
import { TriggerResponse, Metadata } from '#self/delegate/request_response';
import { Readable } from 'stream';
import { Roles, startAllRoles } from '../util';
import { NoslatedClient } from '#self/sdk/index';
import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '#self/data_plane';

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

  let agent: NoslatedClient;
  let control: ControlPlane;
  let data: DataPlane;
  before(async () => {
    await startTurfD();
  });

  after(async () => {
    await stopTurfD();
  });

  beforeEach(async () => {
    const roles = await startAllRoles() as Required<Roles>;
    data = roles.data;
    agent = roles.agent;
    control = roles.control;
  });

  afterEach(async () => {
    if (data) {
      await Promise.all([
        data.close(),
        agent.close(),
        control.close(),
      ]);
    }
  });

  it('invoke readable', async () => {
    await agent.setFunctionProfile([ item.profile ] as any);

    const readable = Readable.from([ Buffer.from('foobar') ]);
    const response = await agent.invoke(item.name, readable);
    assert.ok(response instanceof TriggerResponse);
    assert.ok(response.metadata instanceof Metadata);
    const buffer = await bufferFromStream(response);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');
  });

  it('invoke with malfunctioning readable in immediate', async () => {
    await agent.setFunctionProfile([ item.profile ] as any);

    const readable = new Readable({
      read() {
        this.destroy(new Error('foobar'));
      },
    });

    let err;
    try {
      await agent.invoke(item.name, readable);
    } catch (e) {
      err = e;
    }
    assert.ok(err !== undefined);
    assert.ok((err as Error).message.match(/foobar/));
  });

  // TODO: serialization error, performance cost on iterating.
  it.skip('invoke with mis-typing metadata', async () => {
    await agent.setFunctionProfile([ item.profile ] as any);

    const fatalCases = [
      'foo',
      [ 'foo' ],
      [ 'foo', null ],
    ];
    for (const esac of fatalCases) {
      let err: Error;
      try {
        const stream = await agent.invoke(item.name, Buffer.from('foo'), {
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
      const stream = await agent.invoke(item.name, Buffer.from('foo'), {
        headers: esac,
      } as any);
      stream.destroy();
    }
  });

  // TODO(kaidi.zkd): readable.destroy 之后，服务的识别成正常的 `end` 事件了
  it.skip('invoke with malfunctioning readable in async', async () => {
    await agent.setFunctionProfile([ item.profile ] as any);

    const readable = new Readable({
      read() {},
    });
    const response = await agent.invoke(item.name, readable);
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
