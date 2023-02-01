import assert from 'assert';
import { testName } from '#self/test/common';
import { bufferFromStream } from '#self/lib/util';
import { TriggerResponse, Metadata } from '#self/delegate/request_response';

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

    it('should finish work after destroy', async () => {
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

      const finish = await tr.finish();

      assert.ok(finish);
    });

    it('should finish work data finished', async () => {
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
      }, 500);

      await Promise.all([tr.finish(), await bufferFromStream(tr)]).then(
        ([finish, data]) => {
          assert.ok(finish);
          assert.strictEqual(data.toString(), 'ok');
        }
      );
    });
  });
});
