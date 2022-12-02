import assert from 'assert';
import path from 'path';

import * as common from '../common';
import { testWorker, FIXTURES_DIR } from '../util';
import { DefaultEnvironment } from '../env/environment';

const workersDir = path.join(FIXTURES_DIR, 'starter');

const cases = [
  {
    name: 'node_worker_bootstrap_initializer_not_function',
    profile: {
      name: 'node_worker_bootstrap_initializer_not_function',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_bootstrap`,
      handler: 'not_functions.handler',
      initializer: 'not_functions.initializer',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        timeout: 5000
      },
    },
    expect: {
      error: {
        // TODO: 终态为 /Noslated request failed with CanonicalCode::INTERNAL_ERROR/
        message: /Timeout for waiting worker in 5000ms/,
      },
    },
    attachError: {
      message: /CanonicalCode::INTERNAL_ERROR/,
      peerStack: /Error: Initializer not_functions.initializer is not a function\n[\s\S]+\s+at initializer \(.+\/starter\/base_node.js.+\)/m,
    },
  },
  {
    name: 'node_worker_bootstrap_handler_not_function',
    profile: {
      name: 'node_worker_bootstrap_handler_not_function',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_bootstrap`,
      handler: 'not_functions.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      error: {
        message: /CanonicalCode::INTERNAL_ERROR/,
        peerStack: /Error: Handler not_functions.handler is not a function.\n[\s\S]+\s+at handler \(.+\/starter\/base_node.js.+\)/m,
      },
    },
  },
  {
    name: 'node_worker_bootstrap_syntax_error_with_initializer',
    profile: {
      name: 'node_worker_bootstrap_syntax_error_with_initializer',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_bootstrap`,
      handler: 'syntax_error.handler',
      initializer: 'syntax_error.initializer',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {
        timeout: 5000
      },
    },
    expect: {
      error: {
        // TODO: 终态为 /Noslated request failed with CanonicalCode::INTERNAL_ERROR/
        message: /Timeout for waiting worker in 5000ms/,
      },
    },
    attachError: {
      message: /CanonicalCode::INTERNAL_ERROR/,
      peerStack: /This file is not a valid JavaScript file\.[\s\S]+SyntaxError: Unexpected identifier\n[\s\S]+\s+at parseInitializer \(.+\/starter\/base_node.js.+\)/m,
    },
  },
  {
    name: 'node_worker_bootstrap_syntax_error',
    profile: {
      name: 'node_worker_bootstrap_syntax_error',
      runtime: 'nodejs',
      url: `file://${workersDir}/node_worker_bootstrap`,
      handler: 'syntax_error.handler',
      signature: 'md5:234234',
    },
    input: {
      data: Buffer.from(''),
      metadata: {},
    },
    expect: {
      error: {
        message: /CanonicalCode::INTERNAL_ERROR/,
        peerStack: /This file is not a valid JavaScript file\.[\s\S]+SyntaxError: Unexpected identifier\n[\s\S]+\s+at parseHandler \(.+\/starter\/base_node.js.+\)/m,
      },
    },
  },
];

describe(common.testName(__filename), function () {
  this.timeout(10000);
  const env = new DefaultEnvironment();

  for (const item of cases) {
    it(item.name, async function() {
      this.timeout(6000);

      // TODO: proper error handling in bootstrap
      let attachError: Error;
      env.data.dataFlowController.on('attachError', e => {
        attachError = e;
      });

      await env.agent.setFunctionProfile([ item.profile ] as any);
      await testWorker(env.agent, item);

      if (item.attachError) {
        assert.throws(() => {
          throw attachError;
        }, item.attachError);
      }
    });
  }
});
