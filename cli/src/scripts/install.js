const cp = require('child_process');
const { pipeline } = require('stream');
const arg = require('arg');
const { existsSync } = require('fs');
const { agentModulePath } = require('../utils');

function main(argv) {
  const args = arg({
    '--force': Boolean,
    '-f': '--force'
  }, {
    argv
  });

  if (!args['--force']) {
    if (existsSync(agentModulePath)) {
      console.log('aworker already installed, use `-f` to re install');
      return;
    }
  }

  const package = require('../../package.json');
  const versionOrBuild = package.engines['install-aworker'];

  const env = {
    ak: process.env.ak,
    sk: process.env.sk,
    BUILD: versionOrBuild
  };

  const child = cp.execFile('/bin/bash', ['./tools/install-aworker.sh'], { env });
  pipeline(child.stdout, process.stdout, () => { });
  pipeline(child.stderr, process.stderr, () => { });
}

module.exports = main;

if (require.main === module) {
  main(process.argv.slice(2));
}
