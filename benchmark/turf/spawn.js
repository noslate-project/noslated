'use strict';

const common = require('../common');
const childProcess = require('child_process');

const bench = common.createBenchmark(main, {
  n: [ 1e3 ],
  parallel: [ 3 ],
});

async function spawn() {
  const cp = childProcess.spawn('echo', {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const result = {
    stdout: [],
    stderr: [],
  };
  cp.stdout.on('data', chunk => {
    result.stdout.push(chunk);
  });
  cp.stderr.on('data', chunk => {
    result.stderr.push(chunk);
  });
  return new Promise((resolve, reject) => {
    cp.on('close', (code, signal) => {
      const stdout = Buffer.concat(result.stdout).toString('utf8');
      if (code !== 0) {
        const stderr = Buffer.concat(result.stderr).toString('utf8')
        const err = new Error(`Exited with non-zero code(${code}, ${signal}): ${stderr}`);
        err.code = code;
        err.signal = signal;
        err.stderr = stderr;
        err.stdout = stdout;
        return reject(err);
      }
      resolve(stdout);
    });
  })
}

async function run(n) {
  for (let i = 0; i < n; i++) {
    await spawn();
  }
}

async function main({ n, parallel }) {
  bench.start();
  const promises = [];
  for (let i = 0; i < parallel; i++) {
    promises.push(run(n));
  }
  await Promise.all(promises);
  bench.end(n * parallel);
}
