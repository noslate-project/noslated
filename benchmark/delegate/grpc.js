'use strict';

const common = require('../common');
const { createGrpc, createGrpcClient } = require('./_common');

function child() {
  createGrpcClient((call, callback) => {
    callback(null, { status: 0 });
  });
}

if (process.argv[2] === 'child') {
  return child();
}

const bench = common.createBenchmark(
  createGrpc(__filename, ({ c, duration }, onEnd) => {
    bench.http(
      {
        path: '/',
        connections: c,
        duration,
      },
      onEnd
    );
  }),
  {
    c: [50, 100],
    duration: 5,
  }
);
