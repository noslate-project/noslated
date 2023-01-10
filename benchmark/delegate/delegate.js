'use strict';

const common = require('../common');
const { createDelegate, createDelegateChild } = require('./_common');

module.exports.initializer = async function () {
  /** empty */
};
module.exports.handler = function (ctx, req, res) {
  req.on('data', () => {});
  req.on('end', () => {
    res.on('error', e => {
      console.log(e);
    });
    res.end('foobar');
  });
};

if (process.argv[2] === 'child') {
  return createDelegateChild(__filename);
}

const bench = common.createBenchmark(
  createDelegate(__filename, ({ c, duration, method }, onEnd) => {
    bench.http(
      {
        path: `/${method}`,
        connections: c,
        duration,
      },
      onEnd
    );
  }),
  {
    c: [50, 100],
    duration: 5,
    method: ['init', 'invoke'],
  }
);
