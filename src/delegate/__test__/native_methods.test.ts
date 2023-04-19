import assert from 'assert';
import { once } from 'events';
import * as common from '#self/test/common';
import { TestClient } from './test-client';
import { NoslatedDelegateService } from '#self/delegate/index';

describe(common.testName(__filename), () => {
  let client: TestClient | null;
  let delegate: NoslatedDelegateService | null;
  afterEach(async () => {
    await client?.close();
    delegate?.close();
    client = null;
    delegate = null;
  });
  it('should call client methods', async () => {
    delegate = new NoslatedDelegateService();
    delegate.register('foobar');
    await delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');

    const bindFuture = once(client, 'bind');
    client.connect();
    await bindFuture;

    const ret = await delegate.collectMetrics('foobar');
    assert.ok(Array.isArray(ret.integerRecords));

    const item = ret.integerRecords.find(
      (it: { name: string }) => it.name === 'test'
    );
    assert.ok(item != null);
    const label = item.labels['my_label'];
    assert.ok(typeof label === 'string');
    assert.strictEqual(label, 'foo');
  });
});
