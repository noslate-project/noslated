import assert from 'assert';
import { testName } from '#self/test/common';
import { bufferFromStream } from '#self/lib/util';
import { TriggerResponse, Metadata } from '#self/delegate/request_response';
import { NoslatedResponseEvent } from '#self/lib/constants';

describe(testName(__filename), () => {
  describe('TriggerResponse', () => {
    it('should trigger response work', async () => {
      // default
      const trDefault = new TriggerResponse();
      assert.strictEqual(trDefault.status, 200);
      assert.ok(trDefault.metadata instanceof Metadata);
      // with status and metadata
      const metadata = new Metadata({
        url: 'http://example.com',
        method: 'GET',
        headers: [['x-test-header', 'test-header-value']],
        baggage: [],
        timeout: 5_000,
        requestId: 'test',
      });
      const tr = new TriggerResponse({
        status: 302,
        metadata,
      });
      assert.strictEqual(tr.status, 302);
      assert.deepStrictEqual(tr.metadata, metadata);
      // with status and metadata init
      const trInit = new TriggerResponse({
        status: 302,
        metadata: {
          url: 'http://example.com',
          method: 'GET',
          headers: [['x-test-header', 'test-header-value']],
          baggage: [],
          timeout: 5_000,
          requestId: 'test',
        },
      });
      assert.strictEqual(trInit.status, 302);
      assert.deepStrictEqual(trInit.metadata, metadata);

      trDefault.destroy();
      tr.destroy();
      trInit.destroy();
    });

    it('should wasSent work after destroy', async () => {
      const tr = new TriggerResponse({
        read() {},
        status: 302,
        metadata: {
          url: 'http://example.com',
          method: 'GET',
          headers: [['x-test-header', 'test-header-value']],
          baggage: [],
          timeout: 5_000,
          requestId: 'test',
        },
      });

      setTimeout(() => {
        tr.destroy();
      }, 500);

      const wasSent = await tr.finish();

      assert.ok(wasSent);
    });

    it('should wasSent work data finished', async () => {
      const tr = new TriggerResponse({
        read() {},
        status: 302,
        metadata: {
          url: 'http://example.com',
          method: 'GET',
          headers: [['x-test-header', 'test-header-value']],
          baggage: [],
          timeout: 5_000,
          requestId: 'test',
        },
      });

      tr.push(Buffer.from('ok'));

      setTimeout(() => {
        tr.push(null);
        tr.emit(NoslatedResponseEvent.StreamEnd);
      }, 500);

      const wasSent = await tr.finish();

      assert.ok(wasSent);

      const data = await bufferFromStream(tr);

      assert.strictEqual(data.toString(), 'ok');
    });
  });
});
