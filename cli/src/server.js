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

  constructor({ daprAdaptorPath, startInspectorServerFlag, argv }) {
    this.agentServerPath = agentServerPath;
    this.agentModulePath = agentModulePath;

    this.daprAdaptorPath = daprAdaptorPath;
    this.startInspectorServerFlag = !!startInspectorServerFlag;

    this.spawnArgv = [
      '-A',
      '--has-agent',
      `--agent-ipc=${agentServerPath}`,
      `--agent-cred=${this.credential}`,
      ...(argv ?? [])
    ];
  }

  async run() {
    this.bindDeferedPromise = new createDeferredPromise();
    await this.startNoslatedAgent();

    if (this.startInspectorServerFlag) {
      await this.startInspectorServer();
    }
  }

  async rerun() {
    this.close();
    await this.run();
  }

  async invoke(metadata) {
    const { data, headers, method } = metadata;

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

    return result;
  }

  async waitBind() {
    const t = setTimeout(() => {
      this.bindDeferedPromise.reject('Wait worker bind timeout');
    }, 500);

    await this.bindDeferedPromise.promise;
    clearTimeout(t);
  }

  async spawnAworker() {
    this.aworker = new AworkerProcess(this.spawnArgv, {}, this.agent, this.startInspectorServerFlag, this.credential);

    await this.aworker.spawn();
    await this.waitBind();
  }

  stopAworker() {
    this.aworker.exit();
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
      this.aworker.exit();
    });

    if (this.daprAdaptorPath) {
      const daprAdaptorModule = require(this.daprAdaptorPath);
      const eagleeyeTracer = { close() { }, startSpan() { } };
      const daprAdaptor = new daprAdaptorModule({ eagleeyeTracer, appName: '🈁' });
      await daprAdaptor.ready();
      this.agent.setDaprAdaptor(daprAdaptor);
    }
  }
}

module.exports = AgentDelegate;
