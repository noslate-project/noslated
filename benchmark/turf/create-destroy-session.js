'use strict';

const common = require('../common');
const path = require('path');
const { startTurfD, stopTurfD } = require('#self/lib/turf');
const { TurfSession } = require('#self/lib/turf/session');

process.env.TURF_WORKDIR = path.resolve(__dirname, '../../.turf');
const bundlePath = path.resolve(__dirname, '../fixtures/turf_bundle');
const sockPath = path.resolve(process.env.TURF_WORKDIR, 'turf.sock');

const bench = common.createBenchmark(main, {
  n: [ 1e3 ],
});

async function run(session, n) {
  const name = 'foobar';
  for (let i = 0; i < n; i++) {
    await session.send(['create', '-b', bundlePath, name]);
    await session.send(['delete', name]);
  }
}

async function main({ n }) {
  startTurfD();
  const session = new TurfSession(sockPath);
  await session.connect();

  bench.start();
  await run(session, n);
  bench.end(n);

  await session.close();
  stopTurfD();
}
