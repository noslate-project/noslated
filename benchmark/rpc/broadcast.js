'use strict';

const { once } = require('events');
const { Host } = require('#self/lib/rpc/host');
const { Guest } = require('#self/lib/rpc/guest');
const childProcess = require('child_process');

const common = require('../common');

const address = `unix://${__dirname}/.test.sock`;

if (process.argv[2] === 'child') {
  return child(Number.parseInt(process.argv[3]));
}

const bench = common.createBenchmark(main, {
  n: [ 5e6 ],
});

async function main({ n }) {
  const host = new Host(address);
  await host.start();
  const newSubscriberFuture = once(host, 'new-subscriber');

  const cp = childProcess.fork(__filename, [ 'child', `${n}` ]);
  await newSubscriberFuture;

  cp.on('message', async () => {
    bench.end(n);
    cp.removeAllListeners('exit');
    cp.kill();
    await host.close();
  });
  cp.on('exit', (code, signal) => {
    if (code !== 0 || signal) {
      process.exit(1);
    }
  });
  bench.start();
  for (let i = 0; i < n; i++) {
    host.broadcast('foobar', 'alice.KeyValuePair', { key: 'foo', value: 'bar' });
  }
}

async function child(n) {
  const guest = new Guest(address);
  await guest.start();

  let times = 0;
  guest.subscribe('foobar');
  guest.on('foobar', () => {
    times++;
    if (times === n) {
      process.send('end');
    }
  });
}
