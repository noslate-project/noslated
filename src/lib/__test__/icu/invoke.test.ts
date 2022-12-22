import assert from 'assert';
import childProcess from 'child_process';
import path from 'path';

import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import { Guest } from '#self/lib/rpc/guest';
import { address, once, grpcDescriptor } from '../rpc/util';
import { FIXTURES_DIR } from '#self/test/util';
import * as root from '../../../proto/test';
import { ServerWritableStream } from '@grpc/grpc-js';

const invokePath = require.resolve('#self/lib/icu/invoke');

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let host: Host;
  let guest: Guest;
  let cleanup: (() => unknown) | undefined;

  beforeEach(async () => {
    cleanup = undefined;
    host = new Host(address);
    await host.start();
  });

  afterEach(async () => {
    cleanup?.();
    guest?.close();
    await host.close();
  });

  it('invoke methods', async () => {
    host.addService((grpcDescriptor as any).noslated.test.TestService.service, {
      async ping(call: ServerWritableStream<root.noslated.test.IPing, root.noslated.test.IPong>) {
        return { msg: call.request.msg };
      },
    });

    const cp = childProcess.spawn(process.execPath, [
      invokePath,
      '--sock', address,
      '--service', 'noslated.test.TestService',
      '--include', path.resolve(FIXTURES_DIR, 'proto'),
      'ping', '{"msg": "foobar"}',
    ], {
      stdio: 'pipe',
      env: {
        ...process.env,
        GRPC_TRACE: '',
        GRPC_VERBOSITY: 'NONE',
      },
    });
    cleanup = () => cp.kill();
    cp.stderr.pipe(process.stderr);

    let output = '';
    cp.stdout.setEncoding('utf8');
    cp.stdout.on('data', data => {
      output += data;
    });
    await once(cp, 'exit');
    const parsed = JSON.parse(output);
    assert.strictEqual(parsed.msg, 'foobar');
  });

  it('invoke non-exist methods', async () => {
    const cp = childProcess.spawn(process.execPath, [
      invokePath,
      '--sock', address,
      '--service', 'noslated.test.TestService',
      '--include', path.resolve(FIXTURES_DIR, 'proto'),
      'non-exists', '{"msg": "foobar"}',
    ], {
      stdio: 'pipe',
      env: {
        ...process.env,
        GRPC_TRACE: '',
        GRPC_VERBOSITY: 'NONE',
      },
    });
    cleanup = () => cp.kill();
    cp.stdout.pipe(process.stdout);

    let output = '';
    cp.stderr.setEncoding('utf8');
    cp.stderr.on('data', data => {
      output += data;
    });
    await once(cp, 'exit');

    assert.strictEqual(output.trim(), "IcuError: no method named 'non-exists' in service 'noslated.test.TestService'.");
  });
});
