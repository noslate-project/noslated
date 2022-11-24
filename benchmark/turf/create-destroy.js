'use strict';

const common = require('../common');
const path = require('path');
const { Turf, startTurfD, stopTurfD } = require('#self/lib/turf');
const { config } = require('#self/config');

process.env.TURF_WORKDIR = path.resolve(__dirname, '../../.turf');
const bundlePath = path.resolve(__dirname, '../fixtures/turf_bundle');

const bench = common.createBenchmark(main, {
  n: [ 1e3 ],
  parallel: [ 1 ],
});

async function run(turf, i, n) {
  const name = `foobar-${i}`;
  for (let i = 0; i < n; i++) {
    await turf.create(name, bundlePath);
    await turf.delete(name);
  }
}

async function main({ n, parallel }) {
  startTurfD();
  config.turf.socketSession = false;
  const turf = new Turf(config.turf.bin, config.turf.sockPath);
  bench.start();
  const promises = [];
  for (let i = 0; i < parallel; i++) {
    promises.push(run(turf, i, n));
  }
  await Promise.all(promises);
  bench.end(n * parallel);
  stopTurfD();
}
