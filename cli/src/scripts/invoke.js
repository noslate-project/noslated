const path = require('path');
const fs = require('fs');
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

  const execFileName = otherArgv.find(value => value.endsWith('.js'));

  if (!execFileName) {
    console.error('target .js file not found');
    return;
  }

  const execFilePath = path.join(process.cwd(), execFileName);

  if (!fs.statSync(execFilePath)) {
    console.error('target .js file not found');
    return;
  }

  const agent = new AgentDelegate({
    daprAdaptorPath: daprAdaptorPath,
    startInspectorServerFlag: debug,
    argv: otherArgv,
  });

  await agent.run();

  try {
    await agent.spawnAworker();
  } catch (err) {
    console.error(err);
  }

  await agent.invoke(metadata);
  agent.aworker.exit();
}


module.exports = main;

if (require.main === module) {
  main(process.argv.slice(2));
}
