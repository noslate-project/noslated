import assert from 'assert';
import childProcess from 'child_process';
import Readline from 'readline';
import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import { address, once } from '../rpc/util';
import { Guest } from '#self/lib/rpc/guest';

const listenPath = require.resolve('#self/lib/icu/listen');

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let host: Host;
  let guest: Guest;
  let cleanup: (() => unknown) | undefined;

  beforeEach(async () => {
    cleanup = undefined;
    host = new Host(address);
    await host.start();
  });

  afterEach(async () => {
    cleanup?.();
    guest?.close();
    await host.close();
  });

  it('subscribe events', async () => {
    const newSubscriberFuture = once(host, Host.events.NEW_SUBSCRIBER);

    const cp = childProcess.spawn(process.execPath, [ listenPath, '--sock', address, 'foobar' ], {
      stdio: 'pipe',
      env: {
        ...process.env,
        GRPC_TRACE: '',
        GRPC_VERBOSITY: 'NONE',
      },
    });
    cleanup = () => cp.kill();
    cp.stderr.pipe(process.stderr);

    const readline = Readline.createInterface(cp.stdout);
    readline.on('line', line => {
      const match = line.match(/\[(.+)] (.+): (.+)/);
      if (match == null) {
        return;
      }
      readline.emit(match[2], {
        timestamp: new Date(match[1]).getTime(),
        data: match[3],
      });
    });

    const foobarFuture = once(readline, 'foobar');

    await newSubscriberFuture;
    host.broadcast('foobar', 'noslated.KeyValuePair', { key: 'foo', value: 'bar' });
    const [{ data }] = await foobarFuture;
    const parsed = JSON.parse(data);

    assert.strictEqual(parsed.key, 'foo');
    assert.strictEqual(parsed.value, 'bar');
  });
});
