'use strict';

const listManager = require('./lib/list');

module.exports = function ps() {
  const list = listManager.getList();
  const keys = Object.keys(list);

  for (const key of keys) {
    let str = key;
    let spaces = 20 - key.length;
    if (spaces <= 0) {
      str += ' ';
      spaces = 0;
    }

    while (spaces--) {
      str += ' ';
    }

    let status;
    if (list[key].pid < 0) {
      str += '      0';
      status = list[key].pid === -1 ? 'init' : 'stopped';
    } else {
      let wrote = false;
      try {
        process.kill(list[key].pid, 0);
      } catch (e) {
        wrote = true;
        status = 'stopped';
        str += '      0';
      }

      if (!wrote) {
        const pid = list[key].pid.toString();
        spaces = 7 - pid.length;
        if (spaces <= 0) spaces = 0;
        while (spaces--) {
          str += ' ';
        }
        str += pid;
        status = 'running';
      }
    }

    str += ' ';
    str += status;
    console.log(str);
  }
};
