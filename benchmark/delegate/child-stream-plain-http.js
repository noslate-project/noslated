'use strict';

const common = require('../common');
const { createPlainHttp, createPlainHttpClient } = require('./_common');
const fs = require('fs');
const path = require('path');

function child() {
  createPlainHttpClient((socket, { id }) => {
    const readable = fs.createReadStream(path.resolve(__dirname, '../../fixtures/lorum.txt'), 'utf8');
    readable.setEncoding('utf-8');
    readable.on('data', chunk => {
      socket.write(JSON.stringify({ id, data: chunk }) + '\n');
    });
    readable.on('end', () => {
      socket.write(JSON.stringify({ id, action: 'resolve' }) + '\n');
    });
    socket.write(JSON.stringify({ id, action: 'head' }) + '\n');
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
  c: [ 50, 500 ],
  duration: 5,
});

