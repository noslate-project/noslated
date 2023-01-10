import assert from 'assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import path from 'path';
import util from 'util';

import mm from 'mm';
import serveHandler from 'serve-handler';

import { NoslatedClient } from '#self/sdk/index';
import { createDeferred, bufferFromStream } from '../lib/util';
import { config } from '#self/config';
import { TriggerResponse } from '#self/delegate/request_response';

export function TMP_DIR() {
  const dir = path.join(__dirname, '.tmp');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const FIXTURES_DIR = path.join(config.projectRoot, 'fixtures');

export const unlinkTmpDir = function unlinkTmpDir() {
  fs.rmdirSync(TMP_DIR(), { recursive: true });
};

let resourceServer: http.Server | null;
export const startResourceServer = async function startResourceServer() {
  if (resourceServer) return;
  const { resolve, promise } = createDeferred<void>();
  resourceServer = http.createServer((req, resp) => {
    return serveHandler(req, resp, {
      public: path.join(FIXTURES_DIR, 'resources'),
    });
  });
  resourceServer.listen(55331, () => {
    console.log(
      `http://localhost:55331 => ${path.join(
        FIXTURES_DIR,
        'resources'
      )} listened`
    );
    resolve();
  });
  return promise;
};

export const stopResourceServer = () => {
  if (!resourceServer) return;
  resourceServer.close();
  resourceServer = null;
};

export async function assertWorkerResponse(
  response: TriggerResponse,
  expected: any
) {
  if (expected.status !== undefined) {
    assert.strictEqual(response.status, expected.status);
  } else {
    assert.strictEqual(response.status, 200);
  }
  if (expected.metadata !== undefined) {
    if (expected.metadata.headers != null) {
      for (const [key, value] of expected.metadata.headers) {
        const foundHeaders = response.metadata.headers!.filter(
          it => it[0] === key
        );
        assert.strictEqual(foundHeaders.length, 1, `${key} should present`);
        assert.deepStrictEqual(foundHeaders[0], [key, value]);
      }
    }
  }
  const data = await bufferFromStream(response);
  if (typeof expected.data === 'string') {
    assert.strictEqual(data.toString(), expected.data);
  } else if (expected.data != null) {
    try {
      assert.ok(
        data.equals(expected.data),
        `Expect: data equals (actual dump: ${path.join(
          process.cwd(),
          'actual.out'
        )})`
      );
    } catch (e) {
      fs.writeFileSync('expect.out', expected.data);
      fs.writeFileSync('actual.out', data);
      throw e;
    }
  } else {
    console.log(expected, data.toString());
  }
}

export async function assertWorkerInvoke(
  invokePromise: Promise<any>,
  expected: any
) {
  let error: Error;
  let response;
  try {
    response = await invokePromise;
  } catch (e) {
    error = e as Error;
  }
  if (expected.error) {
    assert.throws(() => {
      throw error;
    }, expected.error);
    return;
  }

  assert.ok(error! == null, util.inspect(error!));
  await assertWorkerResponse(response, expected);
}

export async function assertInvoke(
  agent: NoslatedClient,
  name: string,
  testProfile: any
) {
  await assertWorkerInvoke(
    agent.invoke(name, testProfile.input.data, testProfile.input.metadata),
    testProfile.expect
  );
}

export async function assertInvokeService(
  agent: NoslatedClient,
  name: string,
  testProfile: any
) {
  await assertWorkerInvoke(
    agent.invokeService(
      name,
      testProfile.input.data,
      testProfile.input.metadata
    ),
    testProfile.expect
  );
}

export async function testWorker(agent: NoslatedClient, testProfile: any) {
  await assertWorkerInvoke(
    agent.invoke(
      testProfile.profile.name,
      testProfile.input.data,
      testProfile.input.metadata
    ),
    testProfile.expect
  );
}

export function mockClientCreatorForManager(ManagerClass: any) {
  class DummyClient extends EventEmitter {
    async ready() {
      /* empty */
    }
    async close() {
      /* empty */
    }
  }
  mm(ManagerClass.prototype, '_createPlaneClient', () => new DummyClient());
  mm(ManagerClass.prototype, '_onClientReady', async () => {});
}

export const internetDescribe =
  process.env.NOSLATED_ENABLE_INTERNET_TEST === 'true'
    ? describe
    : describe.skip;
