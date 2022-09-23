'use strict';

const listManager = require('./lib/list');

const stop = require('./stop');

module.exports = function del(name) {
  stop(name, true);

  const list = listManager.getList();
  if (!list[name]) {
    console.error(`${name} not exists.`);
    process.exit(4);
  }

  delete list[name];
  listManager.writeList(list);
};
