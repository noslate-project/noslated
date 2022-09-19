'use strict';

const common = require('../common');
const { structuredClone, jsonClone } = require('#self/lib/util');
const value = require('../../build/lib/json/function_profile_schema');

const bench = common.createBenchmark(main, {
  n: [ 5e4 ],
  type: [ 'json', 'structured-clone' ],
});

function main({ n, type }) {
  bench.start();
  switch (type) {
    case 'json': {
      for (let i = 0; i < n; ++i) {
        jsonClone(value);
      }
      break;
    }
    case 'structured-clone': {
      for (let i = 0; i < n; ++i) {
        structuredClone(value);
      }
      break;
    }
    default: break;
  }
  bench.end(n);
}
