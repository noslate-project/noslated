import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { ResourceServer } from '#self/test/baseline/resource-server';
import { testWorker } from '#self/test/util';
import { config } from '#self/config';
import { DefaultEnvironment } from '#self/test/env/environment';
import { WorkerMetadata } from '../worker_stats';

const sleep = require('#self/lib/util').sleep;

const cases = [
  {
    name: 'node_worker_echo_destroy_after_stopping',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      data: Buffer.from('foobar'),
    },
    after: async ({ turf }: DefaultEnvironment) => {
      const ps = await turf.ps();
      assert(ps.length > 0);
      for (const item of ps) {
        if (item.status === 'running') {
          await turf.stop(item.name, true);
        }
      }

      // process GC interval is 1000
      await sleep(2000);

      assert.deepStrictEqual(await turf.ps(), []);
    },
  },
  {
    name: 'node_worker_echo_replica_limit_in_profile_exceeded',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        replicaCountLimit: 0,
      },
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    expect: {
      error: {
        message:
          /Replica count exceeded limit \(0 \/ 0\) for function node_worker_echo\./,
      },
    },
  },
  {
    name: 'node_worker_echo_replica_limit_in_default_config_exceeded',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_echo`,
      handler: 'index.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
      metadata: {
        method: 'POST',
      },
    },
    before: async ({ control }: DefaultEnvironment) => {
      mm(control['config'].worker, 'replicaCountLimit', 0);
    },
    expect: {
      error: {
        message:
          /Replica count exceeded limit \(0 \/ 0\) for function node_worker_echo\./,
      },
    },
  },
  {
    name: 'node_worker_v8_options',
    profile: {
      name: 'node_worker_v8_options',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_v8_options`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        v8Options: ['--max-heap-size=100', '--no-compilation-cache'],
      },
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        method: 'GET',
      },
    },
    expect: {
      data: Buffer.from(
        '["--max-heap-size=409","--max-heap-size=100","--no-compilation-cache"]'
      ),
    },
  },
  {
    name: 'node_worker_exec_argv',
    profile: {
      name: 'node_worker_exec_argv',
      runtime: 'nodejs',
      url: `file://${baselineDir}/node_worker_v8_options`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        execArgv: ['--max-heap-size=100', '--no-compilation-cache'],
      },
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        method: 'GET',
      },
    },
    expect: {
      data: Buffer.from(
        '["--max-heap-size=409","--max-heap-size=100","--no-compilation-cache"]'
      ),
    },
  },
  {
    name: 'aworker_echo_v8_options',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        v8Options: ['--max-heap-size=100', '--no-compilation-cache'],
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    before: async ({ control }: DefaultEnvironment) => {
      const doStart = control.workerLauncher.starters.aworker.doStart.bind(
        control.workerLauncher.starters.aworker
      );
      mm(
        control.workerLauncher.starters.aworker,
        'doStart',
        async (
          name: any,
          bundlePath: any,
          args: string[],
          profile: any,
          appendEnvs: any,
          options: any
        ) => {
          assert.deepStrictEqual(args.slice(0, 5), [
            'aworker',
            '--max-heap-size=409',
            '--max-heap-size=100',
            '--no-compilation-cache',
            '-A',
          ]);
          return doStart(name, bundlePath, args, profile, appendEnvs, options);
        }
      );
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_exec_argv',
    profile: {
      name: 'aworker_exec_argv',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        execArgv: ['--max-heap-size=100', '--no-compilation-cache'],
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    before: async ({ control }: DefaultEnvironment) => {
      const doStart = control.workerLauncher.starters.aworker.doStart.bind(
        control.workerLauncher.starters.aworker
      );
      mm(
        control.workerLauncher.starters.aworker,
        'doStart',
        async (
          name: any,
          bundlePath: any,
          args: string[],
          profile: any,
          appendEnvs: any,
          options: any
        ) => {
          assert.deepStrictEqual(args.slice(0, 5), [
            'aworker',
            '--max-heap-size=409',
            '--max-heap-size=100',
            '--no-compilation-cache',
            '-A',
          ]);
          return doStart(name, bundlePath, args, profile, appendEnvs, options);
        }
      );
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_reservation',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 4,
      },
      resourceLimit: {
        memory: 256 * 1024 * 1024,
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    after: async ({ control }: DefaultEnvironment) => {
      const broker = control.stateManager.getBroker('aworker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 4) {
          await sleep(10);
        } else {
          break;
        }
      }
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_reservation_memory_limit_exceeded',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 4,
      },
      resourceLimit: {
        memory: 512 * 1024 * 1024,
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    after: async ({ control }: DefaultEnvironment) => {
      const broker = control.stateManager.getBroker('aworker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_lcc',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 1,
      },
      resourceLimit: {
        memory: 512 * 1024 * 1024,
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    after: async ({ control }: DefaultEnvironment) => {
      const workerMetadata = new WorkerMetadata('aworker_echo');
      await control.defaultController['tryBatchLaunch'](workerMetadata, 1);
      const broker = control.stateManager.getBroker('aworker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data plane sync

      const idx = _.random(0, 1, false);
      const names = [...broker.workers.keys()];

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(
        broker.workers.get(names[idx === 0 ? 1 : 0])!.data,
        'activeRequestCount',
        2
      );
      mm(broker, 'redundantTimes', 60);

      await control.defaultController['autoScale']();

      // shrink and leave `names[idx]` because LCC
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(names[idx]), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_filo',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 1,
        shrinkStrategy: 'FILO',
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    after: async ({ control }: DefaultEnvironment) => {
      const workerMetadata = new WorkerMetadata('aworker_echo');
      await control.defaultController['tryBatchLaunch'](workerMetadata, 1);
      const broker = control.stateManager.workerStatsSnapshot.getBroker(
        'aworker_echo',
        false
      )!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data plane sync

      const idx = _.random(0, 1, false);
      const names = [...broker.workers.keys()];
      const workers = [
        broker.workers.get(names[0])!,
        broker.workers.get(names[1])!,
      ].sort((a, b) => {
        return a.registerTime < b.registerTime ? -1 : 1;
      });

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(
        broker.workers.get(names[idx === 0 ? 1 : 0])!.data,
        'activeRequestCount',
        2
      );
      mm(broker, 'redundantTimes', 60);

      await control.defaultController['autoScale']();

      // shrink and leave `names[idx]` because FILO
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(workers[0].name), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'aworker_echo_fifo',
    profile: {
      name: 'aworker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/aworker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        reservationCount: 1,
        shrinkStrategy: 'FIFO',
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    after: async ({ control }: DefaultEnvironment) => {
      const workerMetadata = new WorkerMetadata('aworker_echo');
      await control.defaultController['tryBatchLaunch'](workerMetadata, 1);
      const broker = control.stateManager.getBroker('aworker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data plane sync

      const idx = _.random(0, 1, false);
      const names = [...broker.workers.keys()];
      const workers = [
        broker.workers.get(names[0])!,
        broker.workers.get(names[1])!,
      ].sort((a, b) => {
        return a.registerTime < b.registerTime ? -1 : 1;
      });

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(
        broker.workers.get(names[idx === 0 ? 1 : 0])!.data,
        'activeRequestCount',
        2
      );
      mm(broker, 'redundantTimes', 60);

      await control.defaultController['autoScale']();

      // shrink and leave `names[idx]` because FIFO
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(workers[1].name), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
];

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  before(async () => {
    resourceServer = new ResourceServer();
    await resourceServer.start();
  });

  after(async () => {
    await resourceServer.close();
  });

  beforeEach(async () => {
    mm(
      config.dataPlane,
      'daprAdaptorModulePath',
      require.resolve('#self/test/baseline/dapr-adaptor')
    );
  });

  afterEach(async () => {
    mm.restore();
  });

  for (const item of cases as any[]) {
    describe(item.name, () => {
      beforeEach(() => {
        if (item.seed) {
          // Default CI is non seed mode. Mock it to seed mode and then start all roles.
          mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');
        }
      });

      const env = new DefaultEnvironment();

      const _it =
        (item as any).seed && process.platform === 'darwin' ? it.skip : it;
      _it('test worker', async () => {
        if (item.before) {
          await item.before(env);
        }

        await env.agent.setFunctionProfile([item.profile] as any);
        await testWorker(env.agent, item);
        if (item.after) {
          await item.after(env);
        }
      });
    });
  }
});
