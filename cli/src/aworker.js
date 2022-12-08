const cp = require('child_process');
const { aworkerBin, createDeferredPromise } = require('./utils');

class AworkerProcess {
  aworkerProcess;
  bin;
  args;
  options;
  debug = false;
  credential;
  alive;

  constructor(spawnArgs, options, agent, startInspectorServerFlag, credential) {
    this.bin = aworkerBin;
    this.args = spawnArgs;
    this.options = options;
    this.agent = agent;
    this.debug = startInspectorServerFlag;
    this.credential = credential;
  }

  async spawn() {
    this.aworkerProcess = cp.spawn(this.bin, this.args, this.options);
    this.alive = true;

    this.aworkerProcess.stdout.on('data', buffer => {
      process.stdout.write(buffer);
    });

    this.aworkerProcess.stderr.on('data', buffer => {
      process.stderr.write(buffer);
    });

    this.agent.register(this.credential, { preemptive: true });

    const { promise, resolve } = createDeferredPromise();

    this.aworkerProcess.stderr.on('data', buffer => {
      const data = buffer.toString();

      if (this.debug) {
        if (/Debugger attached./.test(data)) {
          resolve();
        }
      }
    });

    this.aworkerProcess.on('exit', () => {
      this.alive = false;
    });

    if (this.debug) {
      await promise;
    }
  }

  exit() {
    if (this.alive) {
      this.aworkerProcess.kill();
    }
  }

}

module.exports = AworkerProcess;
