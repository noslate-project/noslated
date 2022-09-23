'use strict';

const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const utility = require('utility');

const listManager = require('./lib/list');

module.exports = function start(name, options) {
  const attach = !options.parent.H;

  const list = listManager.getList();
  if (!list[name]) {
    console.error(`${name} not exists.`);
    process.exit(4);
  }

  if (list[name].pid !== -1) {
    let exists = true;
    try {
      process.kill(list[name].pid, 0);
    } catch (e) {
      exists = false;
    }

    if (exists) {
      console.error(`${name} already running.`);
      process.exit(4);
    }
  }

  const spec = utility.readJSONSync(path.join(list[name].cwd, 'config.json'));
  const { process: { args, env } } = spec;

  const envObj = {};
  for (const e of env) {
    const splited = e.split('=');
    const key = splited[0];
    splited.shift();
    envObj[key] = splited.join('=');
  }

  let out;
  let err;

  if (!attach) {
    out = fs.openSync(path.resolve(options.stdout), 'a+');
    err = fs.openSync(path.resolve(options.stderr), 'a+');
  }

  let cmd = args[0];
  args.shift();

  if (cmd === 'node') {
    cmd = cp.execSync('which node', { encoding: 'utf8' }).trim();
  } else if (cmd === 'aworker') {
    cmd = path.join(__dirname, '..', '..', 'bin', 'aworker');
  }

  const child = cp.spawn(cmd, args, {
    env: envObj,
    cwd: path.join(list[name].cwd, 'code'),
    detached: !attach,
    stdio: attach ? 'inherit' : [ 'ignore', out, err ],
  });

  if (!attach) {
    child.unref();
  }

  const { pid } = child;
  list[name].pid = pid;
  listManager.writeList(list);
};
