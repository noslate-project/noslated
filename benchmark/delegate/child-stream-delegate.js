'use strict';

const common = require('../common');
const { createDelegate, createDelegateChild } = require('./_common');
const fs = require('fs');
const path = require('path');

module.exports.initializer = async function() { /** empty */ };
module.exports.handler = function(ctx, req, res) {
  fs.createReadStream(path.resolve(__dirname, '../../fixtures/lorum.txt'), 'utf8').pipe(res);
};

if (process.argv[2] === 'child') {
  return createDelegateChild(__filename);
}

const bench = common.createBenchmark(createDelegate(__filename, ({ c, duration, method }, onEnd) => {
  bench.http({
    path: `/${method}`,
    connections: c,
    duration,
  }, onEnd);
}), {
  c: [ 50, 500 ],
  duration: 5,
  method: [ 'invoke' ],
});
