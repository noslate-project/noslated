const path = require('path');
const os = require('os');

const agentServerPath = path.join(os.tmpdir(), 'noslated.sock');
const agentModulePath = path.join(__dirname, '../out');
const aworkerBin = path.join(agentModulePath, 'bin/aworker');

function getHeaders(headers) {
  let obj;

  if (typeof headers === 'string') {
    obj = JSON.parse(headers);
  } else if (typeof headers === 'object') {
    obj = headers;
  }

  const pairs = Object.entries(obj);
  return pairs;
}

function createDeferredPromise() {
  let res;
  let rej;
  const promise = new Promise((resolve, reject) => {
    res = resolve;
    rej = reject;
  });

  return { promise, resolve: res, reject: rej };
}

module.exports = {
  agentModulePath,
  agentServerPath,
  aworkerBin,
  getHeaders,
  createDeferredPromise
};
