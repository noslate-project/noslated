const cp = require('child_process');
const path = require('path');
const os = require('os');
const stream = require('stream');
const arg = require('arg');

// 写死
const agentServerPath = path.join(os.tmpdir(), 'noslated.sock');
const agentModulePath = path.join(__dirname, '../out');
const bin = path.join(agentModulePath, 'bin/aworker');
const credential = '👁';

class InvokeCommand {
  agent;
  agentModulePath;
  agentServerPath;
  daprAdaptorPath;
  aworkerExecutablePath;
  startInspectorServerFlag;
  credential = credential;
  spawnArgv;
  metadata;
  inspectorAgent;
  aworker;
  invokeMetadata;

  constructor({ agentServerPath, agentModulePath, daprAdaptorPath, aworkerExecutablePath, startInspectorServerFlag, argv, invokeMetadata }) {
    this.agentServerPath = agentServerPath;
    this.agentModulePath = agentModulePath;
    this.daprAdaptorPath = daprAdaptorPath;
    this.aworkerExecutablePath = aworkerExecutablePath;
    this.startInspectorServerFlag = startInspectorServerFlag;
    this.invokeMetadata = invokeMetadata;

    this.spawnArgv = [
      '-A',
      '--has-agent',
      `--agent-ipc=${agentServerPath}`,
      `--agent-cred=${this.credential}`,
      ...(argv ?? [])
    ];
  }

  static getHeaders(headers) {
    const obj = JSON.parse(headers);
    const pairs = Object.entries(obj);
    return pairs;
  }

  async run() {
    await this.startNoslatedAgent();
    if (this.startInspectorServerFlag) {
      await this.startInspectorServer();
    }
    await this.spawnAworker();
    await this.aworker.invoke(this.invokeMetadata);
  }

  async spawnAworker() {
    this.aworker = new Aworker(this.aworkerExecutablePath, this.spawnArgv, {}, this.agent, this.startInspectorServerFlag, this.inspectorAgent, this.credential);

    await this.aworker.spawn();
  }

  async startInspectorServer() {
    const { InspectorAgent } = require(path.join(this.agentModulePath, 'build/diagnostics/inspector_agent'));
    this.inspectorAgent = new InspectorAgent(this.agent);
    await this.inspectorAgent.start();
  }

  async startNoslatedAgent() {
    if (process.env.NOSLATED_LOG_LEVEL) {
      const { loggers, getPrettySink } = require(path.join(this.agentModulePath, 'build/lib/loggers'));
      loggers.setSink(getPrettySink());
    }

    const { NoslatedDelegateService } = require(path.join(this.agentModulePath, 'build/delegate'));

    this.agent = new NoslatedDelegateService(this.agentServerPath);
    await this.agent.start();

    if (this.daprAdaptorPath) {
      const daprAdaptor = require(this.daprAdaptorPath);
      this.agent.setDaprAdaptor(daprAdaptor);
    }

    this.agent.on('disconnect', () => {
      this.agent.close();
    });

    this.agent.on('close', () => {
      process.exit();
    });

  }
}

async function main(argv) {
  const args = arg({
    '--data': String,
    '--debug': Boolean,
    '--method': String,
    '--headers': String,
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

  let debug = false;

  if (args['--debug']) {
    otherArgv.push('--inspect-brk');
    debug = true;
  }

  const metadata = {
    data: null,
    method: 'POST',
    headers: null
  };

  if (args['--data']) {
    metadata.data = args['--data'];
  }

  if (args['--method']) {
    metadata.method = args['--method'];
  }

  if (args['--headers']) {
    metadata.headers = InvokeCommand.getHeaders(args['--headers']);
  }

  const cmd = new InvokeCommand({
    agentServerPath: agentServerPath,
    agentModulePath: agentModulePath,
    daprAdaptorPath: daprAdaptorPath,
    aworkerExecutablePath: bin,
    startInspectorServerFlag: debug,
    argv: otherArgv,
    invokeMetadata: metadata
  });

  cmd.run()
    .catch(console.log);
}

class Aworker {
  inspectorAgent;
  aworkerProcess;
  bin;
  args;
  options;
  debug = false;
  inspectorAgent;
  credential;

  constructor(bin, spawnArgs, options, agent, debug, inspectorAgent, credential) {
    this.bin = bin;
    this.args = spawnArgs;
    this.options = options;
    this.agent = agent;
    this.debug = debug;
    this.inspectorAgent = inspectorAgent;
    this.credential = credential;
  }

  async spawn() {
    this.aworkerProcess = cp.spawn(this.bin, this.args, this.options);

    this.aworkerProcess.stdout.on('data', buffer => {
      process.stdout.write(buffer);
    });

    this.aworkerProcess.stderr.on('data', buffer => {
      process.stderr.write(buffer);
    });

    this.agent.register(this.credential, { preemptive: true });

    await this.waitBind();

    const { promise, resolve } = createDeferredPromise();

    this.aworkerProcess.stderr.on('data', buffer => {
      const data = buffer.toString();

      if (this.debug) {
        if (/Debugger attached./.test(data)) {
          resolve();
        }
      }
    });

    let alive = true;
    const signals = ['SIGTERM', 'SIGINT'];

    for (const it of signals) {
      process.on(it, () => {
        if (this.startInspectorServerFlag) {
          this.inspectorAgent.close();
        }
        if (alive) {
          this.aworkerProcess.kill(it);
        }
      });
    }

    this.aworkerProcess.on('message', () => {
      console.log('sad');
    });

    this.aworkerProcess.on('exit', () => {
      alive = false;
      for (const it of signals) { process.removeAllListeners(it); }
    });

    if (this.debug) {
      await promise;
    }
  }

  async invoke(metadata) {
    const { data, headers, method } = metadata;

    try {
      const rsp = await this.agent.trigger(this.credential, 'invoke', data ? stream.Readable.from(data) : null, { method, headers });

      const result = await new Promise((resolve) => {
        let data = '';

        rsp.on('readable', () => {
          let buf;

          while ((buf = rsp.read()) !== null) {
            data += buf.toString();
          }
        });

        rsp.on('end', () => {
          resolve(data);
        });
      });

      console.log(result);
    } catch (e) {
      console.log(e);
    } finally {
      this.exit();
    }
  }

  exit() {
    //TODO: 理应正常退出，实际 inspector server 未正常关闭
    if (this.startInspectorServerFlag) {
      this.inspectorAgent.close();
    }

    this.agent.close();
    setTimeout(() => {
      process.exit();
    }, 100);
  }

  waitBind() {
    const { promise, resolve } = createDeferredPromise();

    this.agent.on('bind', () => {
      resolve();
    });

    return promise;
  }
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

module.exports = main;

if (require.main === module) {
  console.log(process.argv);
  main(process.argv.slice(2));
}
