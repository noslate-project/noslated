import assert from 'assert';
import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import { Guest } from '#self/lib/rpc/guest';
import { RpcError } from '#self/lib/rpc/error';
import { address, grpcDescriptor, once } from './util';
import * as root from '../../../proto/test';
import { ServerWritableStream } from '@grpc/grpc-js';

describe(common.testName(__filename), () => {
  let host: Host;
  let guest: Guest | null;
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

  it('Host#addService delegation', async () => {
    host.addService((grpcDescriptor as any).noslated.test.TestService.service, {
      async ping(call: ServerWritableStream<root.noslated.test.IPing, root.noslated.test.IPong>) {
        if (call.request.msg === 'error') {
          throw new RpcError('foobar');
        }
        return { msg: call.request.msg };
      },
    });

    guest = new Guest(address);
    guest.addService((grpcDescriptor as any).noslated.test.TestService);
    await guest.start();

    const resp = await (guest as any).ping({ msg: 'foo' });
    assert.strictEqual(resp.msg, 'foo');

    await assert.rejects((guest as any).ping({ msg: 'error' }), /Error: 13 INTERNAL: foobar/);
  });

  it('Host#addService unexpected error', async () => {
    host.addService((grpcDescriptor as any).noslated.test.TestService.service, {
      async ping() {
        throw new Error('foobar');
      },
    });

    guest = new Guest(address);
    guest.addService((grpcDescriptor as any).noslated.test.TestService);
    await guest.start();

    await assert.rejects((guest as any).ping({ msg: 'error' }), /Error: 2 UNKNOWN: foobar/);
  });

  it('Host should emit Host.events.DISCONNECTED event', async () => {
    guest = new Guest(address);
    await guest.start();

    const disconnectedFuture = once(host, Host.events.DISCONNECTED);
    await guest.close();
    guest = null;
    await disconnectedFuture;
  });
});
