const path = require('path');
const { Readable } = require('stream');
const AworkerProcess = require('./aworker');
const { agentModulePath, agentServerPath, createDeferredPromise } = require('./utils');

const credential = '👁';

class AgentDelegate {
  agent;
  agentModulePath;
  agentServerPath;
  daprAdaptorPath;
  aworkerExecutablePath;
  startInspectorServerFlag;
  credential = credential;
  spawnArgv;
  inspectorAgent;
  aworker;
  bindDeferedPromise;
  keepAlive = false;

  constructor({ daprAdaptorPath, startInspectorServerFlag, argv, keepAlive }) {
    this.agentServerPath = agentServerPath;
    this.agentModulePath = agentModulePath;

    this.daprAdaptorPath = daprAdaptorPath;
    this.startInspectorServerFlag = !!startInspectorServerFlag;

    this.bindDeferedPromise = createDeferredPromise();

    this.keepAlive = keepAlive ?? this.keepAlive;


    this.spawnArgv = [
      '-A',
      '--has-agent',
      `--agent-ipc=${agentServerPath}`,
      `--agent-cred=${this.credential}`,
      ...(argv ?? [])
    ];
  }

  async run() {
    await this.startNoslatedAgent();

    if (this.startInspectorServerFlag) {
      await this.startInspectorServer();
    }
  }

  async invoke(metadata) {

    const { data, headers, method } = metadata;

    try {
      const rsp = await this.agent.trigger(this.credential, 'invoke', data ? Readable.from(data) : null, { method, headers });

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
      console.error(e);
    } finally {
      this.inspectorAgent?.close();
    }
  }

  async waitBind() {
    const t = setTimeout(() => {
      this.bindDeferedPromise.reject('Wait worker bind timeout');
    }, 500);

    await this.bindDeferedPromise.promise;
    clearTimeout(t);
  }

  flushBindDeferedPromise() {
    this.bindDeferedPromise = new createDeferredPromise();
  }

  async spawnAworker() {
    this.aworker = new AworkerProcess(this.spawnArgv, {}, this.agent, this.startInspectorServerFlag, this.credential);

    await this.aworker.spawn();
    await this.waitBind();
  }

  async startInspectorServer() {
    const { InspectorAgent } = require(path.join(this.agentModulePath, 'build/diagnostics/inspector_agent'));
    this.inspectorAgent = new InspectorAgent(this.agent);
    await this.inspectorAgent.start();
  }

  close() {
    this.inspectorAgent?.close();
    this.aworker?.exit();
    this.agent.close();
  }

  async startNoslatedAgent() {
    const { NoslatedDelegateService } = require(path.join(this.agentModulePath, 'build/delegate'));
    this.agent = new NoslatedDelegateService(this.agentServerPath);
    await this.agent.start();

    this.agent.on('bind', () => {
      this.bindDeferedPromise.resolve();
    });

    this.agent.on('disconnect', async () => {
      if (this.keepAlive) {
        this.flushBindDeferedPromise();
        await this.spawnAworker();
      } else {
        this.agent.close();
      }
    });

    if (this.daprAdaptorPath) {
      const daprAdaptor = require(this.daprAdaptorPath);
      this.agent.setDaprAdaptor(daprAdaptor);
    }
  }
}

module.exports = AgentDelegate;
