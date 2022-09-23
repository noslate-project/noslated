import assert from 'assert';
import { once } from 'events';
import * as common from '#self/test/common';
import { TestClient } from './test-client';
import { AliceDelegateService } from '#self/delegate/index';
import { WorkerMetricsAttributes, WorkerMetrics } from '#self/lib/telemetry/semantic_conventions';

describe(common.testName(__filename), () => {
  let client: TestClient | null;
  let delegate: AliceDelegateService | null;
  afterEach(async () => {
    await client?.close();
    delegate?.close();
    client = null;
    delegate = null;
  });
  it('should emit bind event', async () => {
    delegate = new AliceDelegateService();
    delegate.register('foobar');
    delegate.start();

    client = new TestClient(delegate.serverSockPath(), 'foobar');

    const bindFuture = once(client, 'bind');
    client.connect();
    await bindFuture;

    const ret = await delegate.collectMetrics('foobar');
    assert.ok(Array.isArray(ret.integerRecords));

    const item = ret.integerRecords.find((it: { name: string; }) => it.name === WorkerMetrics.TOTAL_HEAP_SIZE);
    assert.ok(item != null);
    const pid_label = item.labels[WorkerMetricsAttributes.WORKER_PID];
    assert.ok(typeof pid_label === 'string');
    assert.strictEqual(`${client.pid}`, pid_label);
  });
});
