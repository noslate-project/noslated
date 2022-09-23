
import assert from 'assert';
import _ from 'lodash';
import mm from 'mm';
import * as common from '#self/test/common';
import { baselineDir } from '#self/test/common';
import { ResourceServer } from '#self/test/baseline/resource-server';
import { turf, startTurfD, stopTurfD } from '#self/lib/turf';
import type { Turf } from '#self/lib/turf/wrapper';
import { testWorker, startAllRoles, Roles, ProseContext } from '#self/test/util';
import { AliceAgent } from '#self/sdk/index';
import { ControlPanel } from '../control_panel';
import { DataPanel } from '#self/data_panel';

const sleep = require('#self/lib/util').sleep;

const cases = [
  {
    name: 'node_worker_echo_destroy_after_stopping',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs-v16',
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
    after: async () => {
      const ps = await turf.ps();
      assert(ps.length > 0);
      for (const item of ps) {
        if (item.status === 'running') {
          await turf.stop(item.name);
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
      runtime: 'nodejs-v16',
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
        message: /Replica count exceeded limit \(0 \/ 0\) for function node_worker_echo\./,
      },
    },
  },
  {
    name: 'node_worker_echo_replica_limit_in_default_config_exceeded',
    profile: {
      name: 'node_worker_echo',
      runtime: 'nodejs-v16',
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
    before: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      mm(control['config'].worker, 'replicaCountLimit', 0);
    },
    expect: {
      error: {
        message: /Replica count exceeded limit \(0 \/ 0\) for function node_worker_echo\./,
      },
    },
  },
  {
    name: 'node_worker_v8_options',
    profile: {
      name: 'node_worker_v8_options',
      runtime: 'nodejs-v16',
      url: `file://${baselineDir}/node_worker_v8_options`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        v8Options: [
          '--max-heap-size=100',
          '--no-compilation-cache',
        ],
      },
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        method: 'GET',
      },
    },
    expect: {
      data: Buffer.from('["--max-heap-size=409","--max-heap-size=100","--no-compilation-cache"]'),
    },
  },
  {
    name: 'node_worker_exec_argv',
    profile: {
      name: 'node_worker_exec_argv',
      runtime: 'nodejs-v16',
      url: `file://${baselineDir}/node_worker_v8_options`,
      handler: 'index.handler',
      signature: 'md5:234234',
      worker: {
        execArgv: [
          '--max-heap-size=100',
          '--no-compilation-cache',
        ],
      },
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        method: 'GET',
      },
    },
    expect: {
      data: Buffer.from('["--max-heap-size=409","--max-heap-size=100","--no-compilation-cache"]'),
    },
  },
  {
    name: 'service_worker_echo_v8_options',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        v8Options: [
          '--max-heap-size=100',
          '--no-compilation-cache',
        ],
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    before: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      const doStart = control.workerLauncher.starters.aworker.doStart.bind(control.workerLauncher.starters.aworker);
      mm(
        control.workerLauncher.starters.aworker,
        'doStart',
        async (name: any, bundlePath: any, args: string[], profile: any, appendEnvs: any, options: any) => {
          assert.deepStrictEqual(args.slice(0, 5), [
            'aworker',
            '--max-heap-size=409',
            '--max-heap-size=100',
            '--no-compilation-cache',
            '-A',
          ]);
          return doStart(name, bundlePath, args, profile, appendEnvs, options);
        });
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'service_worker_echo_exec_argv',
    profile: {
      name: 'service_worker_exec_argv',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
      sourceFile: 'index.js',
      signature: 'md5:234234',
      worker: {
        execArgv: [
          '--max-heap-size=100',
          '--no-compilation-cache',
        ],
      },
    },
    input: {
      data: Buffer.from('echo'),
      metadata: {
        method: 'POST',
      },
    },
    before: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      const doStart = control.workerLauncher.starters.aworker.doStart.bind(control.workerLauncher.starters.aworker);
      mm(
        control.workerLauncher.starters.aworker,
        'doStart',
        async (name: any, bundlePath: any, args: string[], profile: any, appendEnvs: any, options: any) => {
          assert.deepStrictEqual(args.slice(0, 5), [
            'aworker',
            '--max-heap-size=409',
            '--max-heap-size=100',
            '--no-compilation-cache',
            '-A',
          ]);
          return doStart(name, bundlePath, args, profile, appendEnvs, options);
        });
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'service_worker_echo_reservation',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
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
    after: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      const broker = control.capacityManager.workerStatsSnapshot.getBroker('service_worker_echo', false)!;
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
    name: 'service_worker_echo_reservation_memory_limit_exceeded',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
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
    after: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      const broker = control.capacityManager.workerStatsSnapshot.getBroker('service_worker_echo', false)!;
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
    name: 'service_worker_echo_lcc',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
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
    after: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      await control.capacityManager.tryExpansion('service_worker_echo', 1, { inspect: false });
      const broker = control.capacityManager.workerStatsSnapshot.getBroker('service_worker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data panel sync

      const idx = _.random(0, 1, false);
      const names = [ ...broker.workers.keys() ];

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(broker.workers.get(names[idx === 0 ? 1 : 0])!.data, 'activeRequestCount', 2);
      mm(broker, 'redundantTimes', 60);

      await control.capacityManager.autoScale();

      // shrink and leave `names[idx]` because LCC
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(names[idx]), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'service_worker_echo_filo',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
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
    after: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      await control.capacityManager.tryExpansion('service_worker_echo', 1, { inspect: false });
      const broker = control.capacityManager.workerStatsSnapshot.getBroker('service_worker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data panel sync

      const idx = _.random(0, 1, false);
      const names = [ ...broker.workers.keys() ];
      const workers = [ broker.workers.get(names[0])!, broker.workers.get(names[1])! ].sort((a, b) => {
        return (a.registerTime < b.registerTime) ? -1 : 1;
      });

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(broker.workers.get(names[idx === 0 ? 1 : 0])!.data, 'activeRequestCount', 2);
      mm(broker, 'redundantTimes', 60);

      await control.capacityManager.autoScale();

      // shrink and leave `names[idx]` because FILO
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(workers[0].name), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
  {
    name: 'service_worker_echo_fifo',
    profile: {
      name: 'service_worker_echo',
      runtime: 'aworker',
      url: `file://${baselineDir}/service_worker_echo`,
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
    after: async ({ control }: Required<ProseContext<{ turf: Turf }>>) => {
      await control.capacityManager.tryExpansion('service_worker_echo', 1, { inspect: false });
      const broker = control.capacityManager.workerStatsSnapshot.getBroker('service_worker_echo', false)!;
      while (true) {
        if (broker.workerCount !== 2) {
          await sleep(10);
        } else {
          break;
        }
      }

      await sleep(2000); // wait for data panel sync

      const idx = _.random(0, 1, false);
      const names = [ ...broker.workers.keys() ];
      const workers = [ broker.workers.get(names[0])!, broker.workers.get(names[1])! ].sort((a, b) => {
        return (a.registerTime < b.registerTime) ? -1 : 1;
      });

      mm(broker.workers.get(names[idx])!.data, 'activeRequestCount', 4);
      mm(broker.workers.get(names[idx === 0 ? 1 : 0])!.data, 'activeRequestCount', 2);
      mm(broker, 'redundantTimes', 60);

      await control.capacityManager.autoScale();

      // shrink and leave `names[idx]` because FIFO
      assert.strictEqual(broker.workers.size, 1);
      assert.notStrictEqual(broker.workers.get(workers[1].name), undefined);
    },
    expect: {
      data: Buffer.from('echo'),
    },
  },
];

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let resourceServer: ResourceServer;
  let agent: AliceAgent;
  let control: ControlPanel;
  let data: DataPanel;

  before(async () => {
    resourceServer = new ResourceServer();
    await resourceServer.start();
  });

  after(async () => {
    await resourceServer.close();
  });

  beforeEach(async () => {
    await startTurfD();
    await turf.destroyAll();
    const roles = await startAllRoles() as Required<Roles>;
    data = roles.data;
    agent = roles.agent;
    control = roles.control;
    await agent.setDaprAdaptor(require.resolve('#self/test/baseline/dapr-adaptor'));
  });

  afterEach(async () => {
    mm.restore();

    if (data) {
      await Promise.all([
        data.close(),
        agent.close(),
        control.close(),
      ]);
    }

    await stopTurfD();
  });

  for (const item of cases as any[]) {
    const _it = ((item as any).seed && process.platform === 'darwin') ? it.skip : it;
    _it(item.name, async () => {
      if (item.seed) {
        // Default CI is non seed mode. Mock it to seed mode and then restart all roles.
        mm(process.env, 'ALICE_FORCE_NON_SEED_MODE', '');
        await Promise.all([ data.close(), agent.close(), control.close() ]);
        ({ data, agent, control } = await startAllRoles() as Required<Roles>);
      }

      if (item.before) {
        await item.before({ agent, control, data, turf } as ProseContext<{ turf: Turf }>);
      }

      await agent.setFunctionProfile([ item.profile ] as any);
      await testWorker(agent, item);
      if (item.after) {
        await item.after({ agent, control, data, turf } as ProseContext<{ turf: Turf }>);
      }
    });
  }
});
