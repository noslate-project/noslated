'use strict';

const childProcess = require('child_process');
const common = require('../common.js');

const RELEASE_OR_DEBUG = process.env.NATIVE_DEBUG ? 'Debug' : 'Release';
const serverPath = './alice-benchmark.sock';

if (process.argv[2] === 'child') {
  child();
  return;
}

const bench = common.createBenchmark(main, {
  n: [ 1e5 ],
});

function child() {
  const { AliceClient } = require(`../../native/addon/${RELEASE_OR_DEBUG}/node_alice_client.node`);

  const client = new AliceClient(serverPath, 'benchmark-cred');
  client.onRequest = (method, sid, metadata, hasInput, hasOutput, callback) => {
    callback(0, null, {
      status: 0,
      headers: [],
    });
  };
  client.onError = () => {};
  client.onDisconnect = () => {};
  client.onBind = () => {};
  client.connect();
}

function main({ n }) {
  const { AliceServer, CanonicalCode } = require(`../../native/addon/${RELEASE_OR_DEBUG}/node_alice.node`);

  let clientId;
  const server = new AliceServer(serverPath);
  server.onRequest = (sessionId, op, params, callback) => {
    if (op === 'Credentials') {
      clientId = sessionId;
      callback(CanonicalCode.OK);

      benchRun(doBench).finally(end);
    }
  };
  server.onDisconnect = () => {};
  server.start();
  const cp = childProcess.fork(__filename, [ 'child' ], { stdio: [ 'ignore', 'ignore', 'ignore', 'ipc' ] });

  async function benchRun(fn) {
    bench.start();
    await fn();
    bench.end(n);
  }

  async function doBench() {
    for (let i = 0; i < n; i++) {
      const resp = server.trigger(clientId, 'foo', {
        headers: [],
        baggage: [],
      }, false, false, 10_000);
      await resp.future;
    }
  }

  function end() {
    cp.kill();
    server.close();
  }
}
