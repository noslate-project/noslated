import assert from 'assert';
import childProcess from 'child_process';
import path from 'path';
import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import { Guest } from '#self/lib/rpc/guest';
import { config } from '#self/config';
import { address, grpcDescriptor, once } from './util';
import * as root from '../../../proto/test';
import { ServerWritableStream } from '@grpc/grpc-js';

const fs = require('fs').promises;

describe(common.testName(__filename), () => {
  describe('basic operations', () => {
    let host: Host;
    let guest: Guest;

    beforeEach(async () => {
      host = new Host(address);
      await host.start();
    });

    afterEach(async () => {
      guest?.close();
      await host.close();
    });

    it('Guest client shared channel', async () => {
      host.addService((grpcDescriptor as any).noslated.test.TestService.service, {
        async ping(call: ServerWritableStream<root.noslated.test.IPing, root.noslated.test.IPong>) {
          return { msg: call.request.msg };
        },
      });
      guest = new Guest(address);
      guest.addService((grpcDescriptor as any).noslated.test.TestService as any);
      await guest.start();
      const resp = await (guest as any).ping({ msg: 'foo' });
      assert.strictEqual(resp.msg, 'foo');
    });

    it('Guest should subscribe once started', async () => {
      const newSubscriberFuture = once(host, Host.events.NEW_SUBSCRIBER);

      guest = new Guest(address);
      // subscribe before start.
      guest.subscribe('foobar');
      await guest.start();
      await newSubscriberFuture;

      const foobarFuture = once(guest, 'foobar');
      host.broadcast('foobar', 'noslated.KeyValuePair', { key: 'foo', value: 'bar' });
      await foobarFuture;
    });

    it('Guest should reconnect on graceful disconnected', async () => {
      guest = new Guest(address);
      {
        const newSubscriberFuture = once(host, Host.events.NEW_SUBSCRIBER);

        await guest.start();
        const foobarFuture = once(guest, 'foobar');
        guest.subscribe('foobar');

        await newSubscriberFuture;
        host.broadcast('foobar', 'noslated.KeyValuePair', { key: 'foo', value: 'bar' });
        await foobarFuture;
      }

      {
        const connectivityStateChangedFuture = once(guest, Guest.events.CONNECTIVITY_STATE_CHANGED);
        await host.close();
        const [ newState ] = await connectivityStateChangedFuture;
        assert.notStrictEqual(newState, Guest.connectivityState.READY);
      }

      {
        const connectivityStateChangedFuture = once(guest, Guest.events.CONNECTIVITY_STATE_CHANGED);
        host = new Host(address);
        const newSubscriberFuture = once(host, Host.events.NEW_SUBSCRIBER);
        await host.start();
        const [ newState ] = await connectivityStateChangedFuture;
        assert.strictEqual(newState, Guest.connectivityState.READY);

        // No need to re-subscribe
        await newSubscriberFuture;
        const foobarFuture = once(guest, 'foobar');
        host.broadcast('foobar', 'noslated.KeyValuePair', { key: 'foo', value: 'bar' });
        await foobarFuture;
      }
    });
  });

  describe('cross-process', function crossProcess() {
    /** debug build may cost more time to bootstrap */
    this.timeout(10_000);

    let guest: Guest;
    let cleanup: (() => unknown) | undefined;

    beforeEach(async () => {
      cleanup = undefined;
    });

    afterEach(async () => {
      cleanup?.();
      guest?.close();
    });

    it('Guest failed to start - socket not exists', async () => {
      guest = new Guest(`unix://${__dirname}/definitely-not-exists.sock`);
      await assert.rejects(guest.start({ connectionTimeout: 1000 }), /Error: Failed to connect before the deadline/);
    });

    it('Guest failed to start - socket closed', async () => {
      guest = new Guest(address);
      await assert.rejects(guest.start({ connectionTimeout: 1000 }), /Error: Failed to connect before the deadline/);
    });

    it('Guest failed to start - socket unstable', async () => {
      const cp = childProcess.fork(path.join(__dirname, './host.js'), [ address ]);
      cleanup = () => {
        cp.kill(9);
      };
      await once(cp, 'message');
      cp.kill();

      guest = new Guest(address);
      await assert.rejects(guest.start({ connectionTimeout: 1000 }), /Error: Failed to connect before the deadline|ECONNRESET|Error: 14 UNAVAILABLE: Connection dropped|Guest stream client failed to receive liveness signal in time./);
    });

    it('Guest failed to start - host unable to send liveness probe', async () => {
      const cp = childProcess.fork(path.join(__dirname, './host_unstable.js'), [ address ]);
      cleanup = () => {
        cp.kill(9);
      };
      await once(cp, 'message');

      guest = new Guest(address, {
        streamClientInitTimeoutMs: 100,
      });

      await assert.rejects(guest.start({ connectionTimeout: 1000 }), /Error: Guest stream client failed to receive liveness signal in time./);
    });

    it('Guest start before host starting', async () => {
      const sockFile = `${config.dirs.noslatedSock}/test.sock`;
      const address = `unix://${sockFile}`;
      await fs.rm(sockFile);
      guest = new Guest(address);
      const startFuture = guest.start();
      const cp = childProcess.fork(path.join(__dirname, './host.js'), [ address ]);
      cleanup = () => {
        cp.kill(9);
      };
      await new Promise<void>(resolve => {
        cp.on('message', msg => {
          console.log('on host message', msg);
          if (msg === Host.events.NEW_CONNECTION) {
            resolve();
          }
        });
      });
      await startFuture;
    });

    it('Guest should reconnect on force disconnected', async () => {
      const cp = childProcess.fork(path.join(__dirname, './host.js'), [ address ]);
      cleanup = () => {
        cp.kill(9);
      };
      await once(cp, 'message');

      guest = new Guest(address);
      await guest.start();

      {
        const connectivityStateChangedFuture = once(guest, Guest.events.CONNECTIVITY_STATE_CHANGED);
        cp.kill(9);
        const [ newState ] = await connectivityStateChangedFuture;
        assert.notStrictEqual(newState, Guest.connectivityState.READY);
      }
    });
  });
});
