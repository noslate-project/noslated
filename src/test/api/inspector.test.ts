import assert from 'assert';

import * as common from '../common';
import { Readable } from 'stream';
import { DefaultEnvironment } from '../env/environment';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { request } from 'urllib';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const env = new DefaultEnvironment();

  it('inspector list', async () => {
    const name = 'aworker_echo';
    const profile: AworkerFunctionProfile = {
      name,
      runtime: 'aworker',
      url: `file:///${common.baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    };
    await env.agent.setFunctionProfile([profile]);
    await env.agent.useInspector(name, true);

    const readable = Readable.from([Buffer.from('foobar')]);
    const response = await env.agent.invoke(name, readable);
    assert.strictEqual(response.status, 200);

    const result = await request('http://localhost:9229/json/list', {
      dataType: 'json',
    });
    assert.ok(Array.isArray(result.data));
    assert.strictEqual(result.data.length, 1);
    const target = result.data[0];
    assert.deepStrictEqual(Object.keys(target), [
      'description',
      'devtoolsFrontendUrl',
      'devtoolsFrontendUrlCompat',
      'faviconUrl',
      'id',
      'title',
      'type',
      'url',
      'webSocketDebuggerUrl',
    ]);
    const [, /** match */ funcName, workerName] = target.url.match(
      /noslate:\/\/workers\/(\w+)\/(\w+)/
    );
    assert.strictEqual(funcName, name);
    assert.strictEqual(typeof workerName, 'string');
  });
});
