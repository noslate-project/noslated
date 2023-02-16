import assert from 'assert';
import { once } from 'events';
import mm from 'mm';
import path from 'path';

import { bufferFromStream } from '#self/lib/util';

import { testWorker, FIXTURES_DIR } from '#self/test/util';
import * as common from '#self/test/common';
import { killWorker } from './util';
import { config } from '#self/config';
import { DefaultEnvironment } from '../env/environment';

const codeDir = path.join(FIXTURES_DIR, 'worker-integrated');

const defaultSeedCases: any = [
  {
    name: 'aworker_math_random',
    profile: {
      name: 'aworker_math_random',
      runtime: 'aworker',
      url: `file://${codeDir}/aworker`,
      sourceFile: 'math-random.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
    },
  },
];

const seedScriptCases: any = [
  {
    name: 'aworker_seed_userland',
    seedScript: `${codeDir}/aworker/seed-userland.js`,
    profile: {
      name: 'aworker_seed_userland',
      runtime: 'aworker',
      url: `file://${codeDir}/aworker`,
      // This is ignored
      sourceFile: 'seed-userland.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
    },
    expect: {
      data: Buffer.from('deserialized'),
    },
  },
  {
    name: 'aworker_seed_userland_error',
    seedScript: `${codeDir}/aworker/seed-userland-serialize-error.js`,
    profile: {
      name: 'aworker_seed_userland_error',
      runtime: 'aworker',
      url: `file://${codeDir}/aworker`,
      // This is ignored
      sourceFile: 'seed-userland-serialize-error.js',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from('foobar'),
    },
    expect: {
      // Should serve the request with non-seed mode as seed process failed to start.
      data: Buffer.from('before-serialize'),
    },
  },
];

const prose = process.platform === 'darwin' ? it.skip : it;
describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  beforeEach(async () => {
    // Default CI is non seed mode. Mock it to seed mode and then restart all roles.
    mm(process.env, 'NOSLATED_FORCE_NON_SEED_MODE', '');
  });
  afterEach(async () => {
    mm.restore();
  });

  describe('default seed', () => {
    const env = new DefaultEnvironment();

    for (const item of defaultSeedCases) {
      prose(item.name, async () => {
        await env.agent.setFunctionProfile([item.profile]);
        let first: Buffer;
        {
          const response = await env.agent.invoke(
            item.name,
            item.input.data,
            item.input.metadata
          );
          first = await bufferFromStream(response);
        }

        await killWorker(env, item.name);

        await once(
          env.control._ctx.getInstance('stateManager').workerStatsSnapshot,
          'workerStopped'
        );

        let second;
        {
          const response = await env.agent.invoke(
            item.name,
            item.input.data,
            item.input.metadata
          );
          second = await bufferFromStream(response);
        }
        assert.notStrictEqual(first.toString(), second.toString());
      });
    }
  });

  describe('seed userland script', () => {
    for (const item of seedScriptCases) {
      describe(item.name, () => {
        beforeEach(async () => {
          mm(config.starter.aworker, 'defaultSeedScript', item.seedScript);
        });

        const env = new DefaultEnvironment();
        prose('testing invoke result', async () => {
          await env.agent.setFunctionProfile([item.profile]);
          await testWorker(env.agent, item);
        });
      });
    }
  });
});
