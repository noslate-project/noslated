'use strict';

const listManager = require('./lib/list');

module.exports = function stop(name, noExit) {
  const list = listManager.getList();
  if (!list[name].pid) {
    if (noExit) return;
    console.error(`${name} not exists.`);
    process.exit(4);
  }

  let exists = true;
  if (list[name].pid === -1) exists = false;
  if (exists) {
    try {
      process.kill(list[name].pid, 0);
    } catch (e) {
      exists = false;
    }
  }
  if (!exists) {
    if (noExit) return;
    console.error(`${name} already stopped.`);
    process.exit(4);
  }
  list[name].pid = -2;
  listManager.writeList(list);

  try {
    process.kill(list[name].pid, 15);
  } catch (e) {
    //
  }
};
