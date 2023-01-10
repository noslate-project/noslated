const path = require('path');
const arg = require('arg');
const AgentDelegate = require('../server');
const { getHeaders } = require('../utils');

async function main(argv) {
  const args = arg({
    '--data': String,
    '--debug': Boolean,
    '--method': String,
    '--headers': String,
    '--dapr-adaptor-path': String,
  }, {
    argv,
    permissive: true
  });

  let daprAdaptorPath;

  if (args['--dapr-adaptor-path']) {
    daprAdaptorPath = path.resolve(args['--dapr-adaptor-path']);
  }

  const otherArgv = args._;

  let debug = false;

  if (args['--debug']) {
    otherArgv.push('--inspect-brk');
    debug = true;
  }

  const metadata = {
    data: null,
    method: 'POST',
    headers: null
  };

  if (args['--data']) {
    metadata.data = args['--data'];
  }

  if (args['--method']) {
    metadata.method = args['--method'];
  }

  if (args['--headers']) {
    metadata.headers = getHeaders(args['--headers']);
  }

  const agent = new AgentDelegate({
    daprAdaptorPath: daprAdaptorPath,
    startInspectorServerFlag: debug,
    argv: otherArgv,
  });

  await agent.run();
  await agent.spawnAworker();

  const result = await agent.invoke(metadata);
  console.log(result);
  agent.close();

  process.exit();
}


module.exports = main;

if (require.main === module) {
  main(process.argv.slice(2));
}
