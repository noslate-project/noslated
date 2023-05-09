import assert from 'assert';

import * as common from '../common';
import { Readable } from 'stream';
import { DefaultEnvironment } from '../env/environment';
import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { request } from 'urllib';
import { Service, icuInvoke } from '../icu';

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

    const targets = await getInspectorTargets();
    assert.ok(Array.isArray(targets));
    assert.strictEqual(targets.length, 1);
    const target = targets[0];
    assertTarget(target, name);
  });

  it('open inspector on existing workers', async () => {
    const name = 'aworker_echo';
    const profile: AworkerFunctionProfile = {
      name,
      runtime: 'aworker',
      url: `file:///${common.baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
    };
    await env.agent.setFunctionProfile([profile]);

    const readable = Readable.from([Buffer.from('foobar')]);
    const response = await env.agent.invoke(name, readable);
    assert.strictEqual(response.status, 200);

    {
      const targets = await icuGetInspectorTargets();
      assert.strictEqual(targets.length, 1);
      const [target] = targets;
      assert.strictEqual(target.functionName, name);
      assert.strictEqual(target.inspectorUrl, undefined);
    }

    {
      const targets = await getInspectorTargets();
      assert.strictEqual(targets.length, 0, 'inspector is not started yet');
    }

    await icuInvoke(Service.DataPlane, 'startInspector', {
      functionName: name,
    });

    {
      const targets = await icuGetInspectorTargets();
      assert.strictEqual(targets.length, 1);
      const [target] = targets;
      assert.strictEqual(target.functionName, name);
      assert.strictEqual(typeof target.inspectorUrl, 'string');
    }

    {
      const targets = await getInspectorTargets();
      assert.strictEqual(targets.length, 1, 'inspector started');
      const target = targets[0];
      assertTarget(target, name);
    }
  });

  it('open inspector on disposable workers when debuggerTag is present', async () => {
    const name = 'aworker_echo';
    const profile: AworkerFunctionProfile = {
      name,
      runtime: 'aworker',
      url: `file:///${common.baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        disposable: true,
      },
    };
    await env.agent.setFunctionProfile([profile]);

    const readable = Readable.from([Buffer.from('foobar')]);
    const response = await env.agent.invoke(name, readable, {
      debuggerTag: 'foobar',
    });
    assert.strictEqual(response.status, 200);

    {
      const targets = await icuGetInspectorTargets();
      assert.strictEqual(targets.length, 1);
      const [target] = targets;
      assert.strictEqual(target.functionName, name);
      assert.strictEqual(target.debuggerTag, 'foobar');
      assert.strictEqual(typeof target.inspectorUrl, 'string');
    }

    {
      const targets = await getInspectorTargets();
      assert.strictEqual(targets.length, 1, 'inspector started');
      const target = targets[0];
      assertTarget(target, name);
    }
  });

  function assertTarget(target: any, expectedFuncName: string) {
    assert.deepStrictEqual(
      Object.keys(target).sort(),
      [
        'description',
        'devtoolsFrontendUrl',
        'devtoolsFrontendUrlCompat',
        'faviconUrl',
        'id',
        'title',
        'type',
        'url',
        'webSocketDebuggerUrl',
      ].sort()
    );
    const { 1: funcName, 2: workerName } = target.url.match(
      /noslate:\/\/workers\/(\w+)\/(\w+)/
    );
    assert.strictEqual(funcName, expectedFuncName);
    assert.strictEqual(typeof workerName, 'string');
  }

  async function getInspectorTargets() {
    const result = await request('http://localhost:9229/json/list', {
      dataType: 'json',
    });
    assert.ok(Array.isArray(result.data));
    return result.data;
  }

  async function icuGetInspectorTargets() {
    const result = await icuInvoke(
      Service.DataPlane,
      'getInspectorTargets',
      {}
    );
    return result.targets;
  }
});
