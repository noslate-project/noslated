'use strict';

const http = require('http');
const childProcess = require('child_process');
const path = require('path');
const common = require('../common.js');
const { Readable } = require('stream');
const fs = require('fs');
const net = require('net');
const Readline = require('readline');
const { CanonicalCode } = require('#self/delegate/noslated_ipc');

const serverPath = './noslated-benchmark.sock';
const serverPort = 'localhost:54433';
const credentials = 'benchmark-cred';
const PROTO_PATH = path.resolve(__dirname, '../fixtures/grpc-test.proto');

module.exports = {
  createPlainHttp,
  createPlainHttpClient,

  serverPath,
  credentials,
  createDelegate,
  createDelegateChild,

  createGrpc,
  createGrpcClient,
};

function createPlainHttpClient(callback) {
  const socket = net.connect(serverPath);
  socket.setEncoding('utf-8');
  const rl = Readline.createInterface(socket);
  rl.on('line', chunk => {
    const data = JSON.parse(chunk);
    callback(socket, data);
  });
}

function createPlainHttp(filename, callback) {
  return main;

  function main(setup) {
    let seq = 0;
    const msgTable = new Map();

    const server = net.createServer(socket => {
      socket.setEncoding('utf8');
      const rl = Readline.createInterface(socket);
      rl.on('line', chunk => {
        const { id, action, data } = JSON.parse(chunk);
        const handler = msgTable.get(id);
        if (handler == null) {
          return;
        }
        if (action === 'head') {
          handler.resolve(handler.readable);
        }
        if (data) {
          handler.readable.push(data);
        }
        if (action === 'resolve') {
          handler.readable.push(null);
        }
      });
      benchRun(socket);
    });
    try {
      fs.unlinkSync(serverPath);
    } catch { /** ignore */ }
    server.listen(serverPath);

    async function send(socket) {
      const id = seq++;
      return new Promise(resolve => {
        msgTable.set(id, { resolve, readable: new Readable({ read: () => {} }) });
        socket.write(JSON.stringify({ id }) + '\n');
      });
    }

    const cp = childProcess.spawn(process.execPath, [ filename, 'child' ], { stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ] });
    cp.on('exit', () => {
      process.exit(1);
    });
    function benchRun(socket) {
      const httpServer = http.createServer(async (req, res) => {
        const readable = await send(socket);
        readable.pipe(res);
      });
      httpServer.listen(common.PORT)
        .on('listening', () => {
          callback(setup, () => {
            cp.removeAllListeners('exit');
            socket.destroy();
            httpServer.close();
            server.close();
            cp.kill();
          });
        });
    }
  }
}

function createDelegateChild(filename) {
  process.env._NOSLATED_IPC_PATH = serverPath;
  process.env._NOSLATED_CODE_PATH = __dirname;
  process.env._NOSLATED_WORKER_CREDENTIAL = credentials;
  process.env._NOSLATED_FUNC_INITIALIZER = `${path.basename(path.relative(__dirname, filename), '.js')}.initializer`;
  process.env._NOSLATED_FUNC_HANDLER = `${path.basename(path.relative(__dirname, filename), '.js')}.handler`;
  require('../../build/starter/noslated_node');
}

function createDelegate(filename, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = null;
  }
  return main;

  function main(setup) {
    require('#self/lib/logger').setSink(require('#self/lib/logger').getPrettySink('benchmark.log'));
    const { NoslatedDelegateService: DelegateService } = require('#self/delegate/index');
    const delegate = new DelegateService(serverPath);
    delegate.register(credentials);
    delegate.on('bind', async () => {
      await delegate.trigger(credentials, 'init');
      benchRun();
    });
    delegate.start();
    const cp = childProcess.fork(filename, [ 'child' ], {
      env: {
        ...process.env,
        _NOSLATED_LOG_LEVEL: 'error',
      },
      stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ],
    });
    cp.on('exit', () => {
      process.exit(1);
    });

    function benchRun() {
      const httpServer = createServer()
        .listen(common.PORT)
        .on('listening', () => {
          callback(setup, () => {
            httpServer.close();
            end();
          });
        });
    }

    function createServer() {
      const server = http.createServer(async (req, res) => {
        doBench(req.url).then(() => {
          res.end('foobar');
        }, e => {
          if (e.code !== CanonicalCode.CANCELLED) {
            console.error('unexpected error', e);
          }
          res.statusCode = 500;
          res.end('foobar');
        });
      });
      return server;
    }

    async function doBench(method) {
      let resp;
      if (method === '/init') {
        resp = await delegate.trigger(credentials, 'init');
      } else {
        resp = await delegate.trigger(credentials, 'invoke', options?.getInput(), {});
      }

      resp.on('data', () => {});
      await new Promise((resolve, reject) => {
        resp.on('error', e => {
          reject(e);
        });
        resp.on('end', resolve);
      });
    }

    function end() {
      delegate.resetPeer(credentials);
      cp.removeAllListeners('exit');
      cp.kill();
      delegate.close();
    }
  }
}

function createGrpcClient(callback) {
  const grpc = require('@grpc/grpc-js');
  const protoLoader = require('@grpc/proto-loader');
  const server = new grpc.Server();
  const packageDefinition = protoLoader.loadSync(
    PROTO_PATH,
    {
      keepCase: true,
    });
  const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);

  server.addService(protoDescriptor.service.service, {
    trigger: callback,
  });
  server.bindAsync(serverPort, grpc.ServerCredentials.createInsecure(), () => {
    server.start();
    process.send('server started');
  });
}

function createGrpc(filename, callback) {
  return main;

  function main(setup) {
    const grpc = require('@grpc/grpc-js');
    const protoLoader = require('@grpc/proto-loader');
    const packageDefinition = protoLoader.loadSync(
      PROTO_PATH,
      {
        keepCase: true,
      });
    const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
    /** @type {import('@grpc/grpc-js').Client} */
    let client;

    function benchRun() {
      const httpServer = createServer()
        .listen(common.PORT)
        .on('listening', () => {
          callback(setup, () => {
            httpServer.close();
            end();
          });
        });
    }

    function createServer() {
      const server = http.createServer(async (req, res) => {
        doBench(req.url).then(() => {
          res.end('foobar');
        }, () => {
          res.statusCode = 500;
          res.end('foobar');
        });
      });
      return server;
    }

    async function doBench() {
      await new Promise((resolve, reject) => {
        client.trigger({ method: 'invoke' }, (error, resp) => {
          if (error) {
            return reject(error);
          }
          resolve(resp);
        });
      });
    }
    const cp = childProcess.fork(filename, [ 'child' ], { stdio: [ 'ignore', 'inherit', 'inherit', 'ipc' ] });
    cp.on('message', () => {
      client = new protoDescriptor.service(serverPort, grpc.credentials.createInsecure());
      benchRun();
    });
    cp.on('exit', (code, signal) => {
      console.log('exit', code, signal);
      process.exit(1);
    });
    process.on('exit', () => {
      cp?.kill();
    });
    function end() {
      client?.close();
      cp.removeAllListeners('exit');
      cp.kill();
    }
  }
}
