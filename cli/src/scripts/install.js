const cp = require('child_process');
const { pipeline } = require('stream');
function main() {
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

