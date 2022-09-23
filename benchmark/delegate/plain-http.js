'use strict';

const common = require('../common');
const { createPlainHttp, createPlainHttpClient } = require('./_common');

function child() {
  createPlainHttpClient((socket, { id }) => {
    socket.write(JSON.stringify({ id, action: 'head' }) + '\n');
    socket.write(JSON.stringify({ id, data: 'foobar' }) + '\n');
    socket.write(JSON.stringify({ id, action: 'resolve' }) + '\n');
  });
}

if (process.argv[2] === 'child') {
  return child();
}

const bench = common.createBenchmark(createPlainHttp(__filename, ({ c, duration }, onEnd) => {
  bench.http({
    path: '/',
    connections: c,
    duration,
  }, onEnd);
}), {
  c: [ 50, 100 ],
  duration: 5,
});

