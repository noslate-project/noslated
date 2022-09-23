'use strict';

const listManager = require('./lib/list');

module.exports = function create(name) {
  const list = listManager.getList();
  if (list[name]) {
    console.error(`${name} exists.`);
    process.exit(4);
  }
  list[name] = {
    cwd: process.cwd(),
    pid: -1,
  };
  listManager.writeList(list);
};
