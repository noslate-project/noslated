import { config } from '#self/config';
import { Clock, systemClock } from '#self/lib/clock';
import { createTestClock, TestClock } from '#self/test/common';
import {
  DefaultEnvironmentOptions,
  MochaEnvironment,
} from '#self/test/env/environment';
import { mockClientCreatorForManager } from '#self/test/util';
import mm from 'mm';
import { ControlPlane } from '../control_plane';
import { DataPlaneClientManager } from '../data_plane_client/manager';
import { TestContainerManager } from './test_container_manager';

export class TestEnvironment extends MochaEnvironment {
  control!: ControlPlane;
  containerManager!: TestContainerManager;
  clock!: Clock;
  testClock!: TestClock;

  constructor(private options?: DefaultEnvironmentOptions) {
    super();
  }

  async beforeEach(ctx: Mocha.Context) {
    ctx.timeout(10_000 + ctx.timeout());

    if (this.options?.createTestClock) {
      this.testClock = createTestClock({
        shouldAdvanceTime: true,
      });
      this.clock = this.testClock;
    } else {
      this.clock = systemClock;
    }

    this.containerManager = new TestContainerManager(this.clock);

    mockClientCreatorForManager(DataPlaneClientManager);
    this.control = new ControlPlane(config, {
      clock: this.clock,
      containerManager: this.containerManager,
    });

    await this.control.ready();
  }

  async afterEach() {
    mm.restore();
    await this.control.close();
    if (this.testClock) {
      this.testClock.uninstall();
    }
  }
}
