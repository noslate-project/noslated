import { config } from '#self/config';
import { ControlPlane } from '#self/control_plane/index';
import { DataPlane } from '#self/data_plane/index';
import { Turf } from '#self/lib/turf';
import { createDeferred } from '#self/lib/util';
import { NoslatedClient } from '#self/sdk/index';
import { startTurfD, stopTurfD } from '#self/test/turf';

export abstract class MochaEnvironment {
  constructor() {
    const self = this;
    before(async function before() {
      const ctx = this;
      await self.before(ctx);
    });

    after(async function after() {
      const ctx = this;
      await self.after(ctx);
    });

    beforeEach(async function beforeEach() {
      const ctx = this;
      await self.beforeEach(ctx);
    });

    afterEach(async function afterEach() {
      const ctx = this;
      await self.afterEach(ctx);
    });
  }

  protected before(ctx: Mocha.Context): Promise<void> {
    return Promise.resolve();
  }

  protected after(ctx: Mocha.Context): Promise<void> {
    return Promise.resolve();
  }

  protected beforeEach(ctx: Mocha.Context): Promise<void> {
    return Promise.resolve();
  }

  protected afterEach(ctx: Mocha.Context): Promise<void> {
    return Promise.resolve();
  }
}

export class DefaultEnvironment extends MochaEnvironment {
  data!: DataPlane;
  control!: ControlPlane;
  agent!: NoslatedClient;
  turf!: Turf;

  async beforeEach(ctx: Mocha.Context) {
    ctx.timeout(10_000);

    startTurfD();
    this.agent = new NoslatedClient();
    this.control = new ControlPlane(config);
    this.data = new DataPlane(config);
    this.turf = this.control.turf;

    let readyCount = 0;
    const { resolve, promise } = createDeferred<void>();
    this.control.once('newDataPlaneClientReady', onNewClientReady.bind(undefined, 'control>data client'));
    this.agent.once('newDataPlaneClientReady', onNewClientReady.bind(undefined, 'agent>data client'));
    this.agent.once('newControlPlaneClientReady', onNewClientReady.bind(undefined, 'agent>ctrl client'));

    function onNewClientReady(name: string) {
      console.log(`${name} connected!`);
      readyCount++;
      if (readyCount === 3) {
        resolve();
      }
    }

    await Promise.all([
      this.data.ready(),
      this.control.ready(),
      this.agent.start(),
    ]);

    await promise;
  }

  async afterEach() {
    await Promise.all([
      this.agent.close(),
      this.data.close(),
      this.control.close(),
    ]);

    stopTurfD();
  }
}
