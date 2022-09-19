import assert from 'assert';
import * as common from '#self/test/common';
import { Host } from '#self/lib/rpc/host';
import { Guest } from '#self/lib/rpc/guest';
import { HostEvents } from '#self/lib/rpc/util';
import { address, once } from './util';

describe(common.testName(__filename), function() {
  let host: Host;
  /** @type {Guest} */
  let guest: Guest;
  let cleanup: Function | undefined;

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

  it('Host broadcast', async () => {
    const newSubscriberFuture = once(host, Host.events.NEW_SUBSCRIBER);

    guest = new Guest(address);
    await guest.start();
    const foobarFuture = once(guest, 'foobar');
    guest.subscribe('foobar');

    await newSubscriberFuture;
    host.broadcast('foobar', 'alice.KeyValuePair', { key: 'foo', value: 'bar' });
    const [ data ] = await foobarFuture;
    assert.strictEqual(data.key, 'foo');
    assert.strictEqual(data.value, 'bar');
  });

  it('Host liveness probe', async () => {
    const connectionFuture = once(host, Host.events.NEW_CONNECTION);

    guest = new Guest(address);
    await guest.start();

    const livenessFuture = once(guest, HostEvents.LIVENESS);
    await connectionFuture;

    guest.livenessCheckpoint();
    const [ data ] = await livenessFuture;
    assert.strictEqual(typeof data.timestamp, 'number');
  });
});
