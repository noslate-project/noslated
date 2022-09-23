'use strict';

module.exports = {
  extends: '../build/.eslintrc.js',
  env: {
    browser: true,
    node: true,
    serviceworker: true,
  },
  globals: {
    aworker: 'readonly',
  },
};
