import { ControlPlane } from '#self/control_plane';
import { DataPlane } from '#self/data_plane';
import { Turf } from '#self/lib/turf';
import { NoslatedClient } from '#self/sdk';
import { startTurfD, stopTurfD } from '#self/test/turf';
import { startAllRoles } from '../util';

export abstract class MochaEnvironment {
  constructor() {
    before(async () => {
      await this.before();
    });

    after(async () => {
      await this.after();
    });

    beforeEach(async () => {
      await this.beforeEach();
    });

    afterEach(async () => {
      await this.afterEach();
    });
  }

  protected before(): Promise<void> {
    return Promise.resolve();
  }

  protected after(): Promise<void> {
    return Promise.resolve();
  }

  protected beforeEach(): Promise<void> {
    return Promise.resolve();
  }

  protected afterEach(): Promise<void> {
    return Promise.resolve();
  }
}

export class DefaultEnvironment extends MochaEnvironment {
  data!: DataPlane;
  control!: ControlPlane;
  agent!: NoslatedClient;
  turf!: Turf;

  async beforeEach() {
    startTurfD();
    const roles = await startAllRoles();
    this.data = roles.data;
    this.control = roles.control;
    this.agent = roles.agent;
    this.turf = this.control.turf;
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
