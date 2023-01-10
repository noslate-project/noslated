import path from 'path';

import * as common from '../common';
import { testWorker, FIXTURES_DIR } from '../util';
import { DefaultEnvironment } from '../env/environment';

const workersDir = path.join(FIXTURES_DIR, 'starter');

const cases = [
  {
    name: 'node_worker_timeout_no_metadata',
    profile: {
      name: 'node_worker_timeout_no_metadata',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_timeout`,
      handler: 'no_metadata.handler',
      signature: 'md5:234234',
    },
    input: {
      metadata: {
        method: 'GET',
        timeout: 1000,
      },
    },
    expect: {
      error: {
        message: /CanonicalCode::TIMEOUT/,
        operation: /Trigger/,
      },
    },
  },
] as const;

describe(common.testName(__filename), () => {
  const env = new DefaultEnvironment();

  for (const item of cases) {
    it(item.name, async () => {
      await env.agent.setFunctionProfile([item.profile]);
      await testWorker(env.agent, item);
    });
  }
});
