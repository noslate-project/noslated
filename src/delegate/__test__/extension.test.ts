import assert from 'assert';
import * as common from '#self/test/common';
import { DefaultNamespaceResolver } from '#self/delegate/namespace';
import { Extension } from '#self/delegate/extension';
import { CapacityExceededError, NotFoundError } from '#self/delegate/error';
import { config } from '#self/config';

const empty = new Uint8Array();
describe(common.testName(__filename), () => {
  describe('Extension', () => {
    describe('kv', () => {
      const credentials = 'foobar';

      it('common kv operations', () => {
        const extension = new Extension(new DefaultNamespaceResolver());
        extension.kv(credentials, 'open', { namespace: 'ns1' }, empty);

        let result = extension.kv(
          credentials,
          'get',
          { namespace: 'ns1', key: 'key1' },
          empty
        );
        assert.deepStrictEqual(result, { status: 200, data: undefined });

        result = extension.kv(
          credentials,
          'set',
          { namespace: 'ns1', key: 'key1' },
          Buffer.from('bar')
        );
        assert.deepStrictEqual(result, { status: 200, data: undefined });

        result = extension.kv(credentials, 'list', { namespace: 'ns1' }, empty);
        assert.deepStrictEqual(result, {
          status: 200,
          data: Buffer.from('["key1"]'),
        });

        result = extension.kv(
          credentials,
          'delete',
          { namespace: 'ns1', key: 'key1' },
          empty
        );
        assert.deepStrictEqual(result, { status: 200, data: undefined });

        result = extension.kv(credentials, 'list', { namespace: 'ns1' }, empty);
        assert.deepStrictEqual(result, {
          status: 200,
          data: Buffer.from('[]'),
        });
      });

      it('operation on not opened storage', () => {
        const extension = new Extension(new DefaultNamespaceResolver());
        assert.throws(
          () =>
            extension.kv(
              credentials,
              'get',
              { namespace: 'ns1', key: 'key1' },
              empty
            ),
          NotFoundError
        );
        assert.throws(
          () =>
            extension.kv(
              credentials,
              'set',
              { namespace: 'ns1', key: 'key1' },
              Buffer.allocUnsafe(
                config.delegate.kvStoragePerNamespaceMaxByteLength + 1
              )
            ),
          NotFoundError
        );
        assert.throws(
          () =>
            extension.kv(
              credentials,
              'list',
              { namespace: 'ns1', key: 'key1' },
              empty
            ),
          NotFoundError
        );
        assert.throws(
          () =>
            extension.kv(
              credentials,
              'delete',
              { namespace: 'ns1', key: 'key1' },
              empty
            ),
          NotFoundError
        );
      });

      it('capacity check', () => {
        const extension = new Extension(new DefaultNamespaceResolver());
        extension.kv(credentials, 'open', { namespace: 'ns1' }, empty);
        assert.throws(
          () =>
            extension.kv(
              credentials,
              'set',
              { namespace: 'ns1', key: 'key1' },
              Buffer.allocUnsafe(
                config.delegate.kvStoragePerNamespaceMaxByteLength + 1
              )
            ),
          CapacityExceededError
        );
      });

      it('evict keys with lru', () => {
        const extension = new Extension(new DefaultNamespaceResolver());
        extension.kv(
          credentials,
          'open',
          { namespace: 'ns1', lru: true },
          empty
        );
        extension.kv(
          credentials,
          'set',
          { namespace: 'ns1', key: 'key1' },
          Buffer.allocUnsafe(
            config.delegate.kvStoragePerNamespaceMaxByteLength -
              /* key byte length + 1*/ 5
          )
        );

        extension.kv(
          credentials,
          'set',
          { namespace: 'ns1', key: 'key2' },
          Buffer.from('foobarfoobar')
        );

        /** key1 should be evicted */
        let result = extension.kv(
          credentials,
          'get',
          { namespace: 'ns1', key: 'key1' },
          empty
        );
        assert.deepStrictEqual(result, { status: 200, data: undefined });
        result = extension.kv(
          credentials,
          'get',
          { namespace: 'ns1', key: 'key2' },
          empty
        );
        assert.deepStrictEqual(result, {
          status: 200,
          data: Buffer.from('foobarfoobar'),
        });
      });
    });
  });
});
