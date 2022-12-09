const path = require('path');
const http = require('http');
const fs = require('fs');
const chokidar = require('chokidar');
const arg = require('arg');
const AgentDelegate = require('../../server');
const { getHeaders } = require('../../utils');

async function main(argv) {
  const args = arg({
    '--port': Number,
    '--debug': Boolean,
    '--dapr-adaptor-path': String,
  }, {
    argv,
    permissive: true
  });

  let daprAdaptorPath;

  if (args['--dapr-adaptor-path']) {
    daprAdaptorPath = path.resolve(args['--dapr-adaptor-path']);
  }

  const otherArgv = args._;

  const execFileName = otherArgv.find(value => path.isAbsolute(path.resolve(value)));

  if (!execFileName) {
    console.error('target file not found');
    return;
  }

  let execFilePath = path.resolve(execFileName);

  if ((await fs.promises.lstat(execFileName)).isDirectory()) {
    execFilePath = path.join(execFileName, 'index.js');
  }

  let startInspectorServerFlag = false;

  if (args['--debug']) {
    otherArgv.push('--inspect-brk');
    startInspectorServerFlag = true;
  }

  let port;

  if (args['--port']) {
    port = args['--port'];
  }

  const command = new DevCommand(port, startInspectorServerFlag, execFilePath, daprAdaptorPath, otherArgv);

  command
    .run()
    .catch(console.error);

}

class DevCommand {
  server;
  port = 3000;
  invokeHandler;
  startInspectorServerFlag;
  execFilePath;
  aworker;
  argv;
  daprAdaptorPath;
  agent;

  constructor(port, startInspectorServerFlag, execFilePath, daprAdaptorPath, argv) {
    this.port = port ?? this.port;
    this.startInspectorServerFlag = !!startInspectorServerFlag;
    this.execFilePath = execFilePath;
    this.daprAdaptorPath = daprAdaptorPath;
    this.argv = argv;
  }

  serve() {
    this.server = http.createServer(this.handler.bind(this));
    this.server.listen(this.port, () => {
      console.log(`Dev server served at http://localhost:${this.port}`);
    });
  }

  startWatch() {
    const watcher = chokidar.watch(this.execFilePath);
    watcher.on('change', async path => {
      console.clear();
      console.log(`File ${path} has been changed`);
      await this.agent.rerun();
      await this.agent.spawnAworker();
    });
  }

  async handler(req, res) {
    const method = req.method;
    const headers = req.headers;

    const body = await new Promise((resolve) => {
      const chunks = [];
      req.on('data', chunk => {
        chunks.push(chunk);
      });
      req.on('end', () => {
        resolve(Buffer.concat(chunks, parseInt(headers['content-length'])));
      });
    });

    const metadata = {
      data: null,
      method: 'POST',
      headers: null
    };

    if (body) {
      metadata.data = body;
    }

    metadata.method = method;
    metadata.headers = getHeaders(headers);
    const start = performance.now();
    let result;

    try {
      result = await this.agent.invoke(metadata);
    } catch (e) {
      console.error(e);
    }

    res.end(result);

    console.log(`Url: ${req.url}, Method: ${method}, Headers: ${metadata.headers}, Cost: ${(performance.now() - start).toFixed(3)}ms`);

    await this.agent.rerun();
    await this.agent.spawnAworker();
  }

  async run() {
    this.agent = new AgentDelegate({
      daprAdaptorPath: this.daprAdaptorPath,
      startInspectorServerFlag: this.startInspectorServerFlag,
      argv: this.argv,
    });

    this.serve();
    this.startWatch();

    await this.agent.run();
    await this.agent.spawnAworker();
  }
}

module.exports = main;

if (require.main === module) {
  main(process.argv.slice(2));
}
