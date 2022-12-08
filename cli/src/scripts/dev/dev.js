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

  const execFileName = otherArgv.find(value => value.endsWith('.js'));

  if (!execFileName) {
    console.error('target .js file not found');
    return;
  }

  const execFilePath = path.join(process.cwd(), execFileName);

  if (!fs.statSync(execFilePath)) {
    console.error('target .js file not found');
    return;
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
    watcher.on('change', path => {
      console.log(`File ${path} has been changed`);
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

    const data = await this.agent.invoke(metadata);

    res.end(data);
  }

  async run() {
    this.agent = new AgentDelegate({
      daprAdaptorPath: this.daprAdaptorPath,
      startInspectorServerFlag: this.startInspectorServerFlag,
      argv: this.argv,
      keepAlive: true
    });

    await this.agent.run();
    await this.agent.spawnAworker();

    this.serve();
    this.startWatch();
  }
}

module.exports = main;

if (require.main === module) {
  main(process.argv.slice(2));
}
