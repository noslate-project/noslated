import assert from 'assert';
import { EventEmitter } from 'events';
import fs from 'fs';
import http from 'http';
import path from 'path';
import util from 'util';

import mm from 'mm';
import serveHandler from 'serve-handler';

import { AliceAgent } from '#self/sdk/index';
import { ControlPanel } from '#self/control_panel/index';
import { DataPanel } from '#self/data_panel/index';
import { createDeferred, bufferFromStream } from '../lib/util';
import { config } from '#self/config';
import { startTurfD, stopTurfD } from '#self/lib/turf';
import { TriggerResponse } from '#self/delegate/request_response';
import { TestProcessor } from './telemetry-util';
import { MeterProvider } from '@opentelemetry/metrics';
import { Turf } from '#self/lib/turf/wrapper';

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
    console.log(`http://localhost:55331 => ${path.join(FIXTURES_DIR, 'resources')} listened`);
    resolve();
  });
  return promise;
};

export const stopResourceServer = () => {
  if (!resourceServer) return;
  resourceServer.close();
  resourceServer = null;
};

export function closeAutoProcessRecyclingStrategy(item: any) {
  item.autoProcessRecyclingStrategy.end();
};

export async function assertWorkerResponse(response: TriggerResponse, expected: any) {
  if (expected.status !== undefined) {
    assert.strictEqual(response.status, expected.status);
  } else {
    assert.strictEqual(response.status, 200);
  }
  if (expected.metadata !== undefined) {
    if (expected.metadata.headers != null) {
      for (const [ key, value ] of expected.metadata.headers) {
        const foundHeaders = response.metadata.headers!.filter(it => it[0] === key);
        assert.strictEqual(foundHeaders.length, 1, `${key} should present`);
        assert.deepStrictEqual(foundHeaders[0], [ key, value ]);
      }
    }
  }
  const data = await bufferFromStream(response);
  if (typeof expected.data === 'string') {
    assert.strictEqual(data.toString(), expected.data);
  } else if (expected.data != null) {
    try {
      assert.ok(data.equals(expected.data), `Expect: data equals (actual dump: ${path.join(process.cwd(), 'actual.out')})`);
    } catch (e) {
      fs.writeFileSync('expect.out', expected.data);
      fs.writeFileSync('actual.out', data);
      throw e;
    }
  } else {
    console.log(expected, data.toString());
  }
}

export async function assertWorkerInvoke(invokePromise: Promise<any>, expected: any) {
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

export async function assertInvoke(agent: AliceAgent, name: string, testProfile: any) {
  await assertWorkerInvoke(agent.invoke(name, testProfile.input.data, testProfile.input.metadata), testProfile.expect);
}

export async function assertInvokeService(agent: AliceAgent, name: string, testProfile: any) {
  await assertWorkerInvoke(agent.invokeService(name, testProfile.input.data, testProfile.input.metadata), testProfile.expect);
}

export async function testWorker(agent: AliceAgent, testProfile: any) {
  await assertWorkerInvoke(agent.invoke(testProfile.profile.name, testProfile.input.data, testProfile.input.metadata), testProfile.expect);
}

export async function startAllRoles(): Promise<Roles> {
  const agent = new AliceAgent();
  const control = new ControlPanel(config);
  const data = new DataPanel(config);

  let readyCount = 0;
  const { resolve, promise } = createDeferred<Roles>();
  control.once('newDataPanelClientReady', onNewClientReady.bind(undefined, 'control>data client'));
  agent.once('newDataPanelClientReady', onNewClientReady.bind(undefined, 'agent>data client'));
  agent.once('newControlPanelClientReady', onNewClientReady.bind(undefined, 'agent>ctrl client'));

  function onNewClientReady(name: string) {
    console.log(`${name} connected!`);
    readyCount++;
    if (readyCount === 3) {
      resolve({ data, control, agent });
    }
  }

  await Promise.all([
    data.ready(),
    control.ready(),
    agent.start(),
  ]);

  return promise;
}

export function daemonProse<T>(roles: ProseContext<T>) {
  beforeEach(async () => {
    await startTurfD();
    const _roles = await startAllRoles();
    Object.assign(roles, _roles);
  });

  afterEach(async () => {
    await Promise.all([
      roles.agent?.close(),
      roles.data?.close(),
      roles.control?.close(),
    ]);

    await stopTurfD();
  });
}

export function mockClientCreatorForManager(ManagerClass: any) {
  class DummyClient extends EventEmitter {
    async ready() { /* empty */ }
    async close() { /* empty */ }
  }
  mm(ManagerClass.prototype, '_createPanelClient', () => new DummyClient());
  mm(ManagerClass.prototype, '_onClientReady', async () => {});
}

export const internetDescribe = process.env.ALICE_ENABLE_INTERNET_TEST === 'true' ? describe : describe.skip;

export interface Roles {
  data?: DataPanel;
  control?: ControlPanel;
  agent?: AliceAgent;
}

export interface TurfContext {
  turf?: Turf;
}

export interface TelemetryContext {
  meterProvider?: MeterProvider;
  processor?: TestProcessor;
}

export type ProseContext<T> = T & Roles;
