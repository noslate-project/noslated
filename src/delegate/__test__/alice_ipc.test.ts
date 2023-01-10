import {
  NoslatedClient,
  NoslatedServer,
  CanonicalCode,
  MessageParser,
} from '#self/delegate/noslated_ipc';
import { aworker } from '#self/proto/aworker';
import assert from 'assert';
import os from 'os';
import { testName } from '#self/test/common';

const serverPath = `/${os.tmpdir()}/test.sock`;

describe(testName(__filename), () => {
  describe('ipc', () => {
    let server: NoslatedServer;
    let client: NoslatedClient;
    afterEach(() => {
      server?.close();
      client?.close();
    });

    it('should throw on start', async () => {
      server = new NoslatedServer('/tmp/invalid/server/path');
      await assert.rejects(server.start(), 'should fail to start');

      // no need to be closed.
      (server as any) = undefined;
    });

    it('should connect and request', async () => {
      server = new NoslatedServer(serverPath);
      server.onRequest = (sessionId, op, params, callback) => {
        if (op !== 'Credentials') {
          return callback(CanonicalCode.NOT_IMPLEMENTED);
        }
        if (
          (params as aworker.ipc.ICredentialsRequestMessage).cred !== 'foobar'
        ) {
          return callback(CanonicalCode.CLIENT_ERROR);
        }
        return callback(CanonicalCode.OK);
      };
      await server.start();

      client = new NoslatedClient(serverPath, 'foobar');
      await client.start();
    });

    describe('NoslatedServer', () => {
      let sessionId = -1;
      beforeEach(() => {
        sessionId = -1;
      });

      function createSimpleServer() {
        server = new NoslatedServer(serverPath);
        server.onRequest = (sid, op, params, callback) => {
          if (op !== 'Credentials') {
            return callback(CanonicalCode.NOT_IMPLEMENTED);
          }
          if (
            (params as aworker.ipc.ICredentialsRequestMessage).cred !== 'foobar'
          ) {
            return callback(CanonicalCode.CLIENT_ERROR);
          }
          sessionId = sid;
          return callback(CanonicalCode.OK);
        };
      }

      it('should trigger requests', async () => {
        createSimpleServer();
        await server.start();

        client = new NoslatedClient(serverPath, 'foobar');
        await client.start();
        client.onRequest = (
          method,
          streamId,
          metadata,
          hasInputData,
          hasOutputData,
          callback
        ) => {
          if (method !== 'test') {
            callback(CanonicalCode.CLIENT_ERROR);
            return;
          }
          const resp: aworker.ipc.ITriggerResponseMessage = {
            status: 200,
            metadata,
          };
          callback(CanonicalCode.OK, null, resp);
        };

        assert(sessionId >= 0);
        const metadata = {
          url: 'http://example.com',
          method: 'GET',
          baggage: ['foo', 'bar'],
          headers: ['quz', 'qak'],
        };
        const ret = server.trigger(
          sessionId,
          'test',
          metadata,
          false,
          false,
          1000
        );

        assert(ret.sid == null);
        const resp = await ret.future;
        assert.deepStrictEqual(resp, {
          status: 200,
          metadata: {
            headers: [['quz', 'qak']],
          },
        });
      });

      it('should trigger requests with server streams', async () => {
        createSimpleServer();
        await server.start();

        client = new NoslatedClient(serverPath, 'foobar');
        await client.start();
        let cb: any;
        client.onRequest = (
          method,
          streamId,
          metadata,
          hasInputData,
          hasOutputData,
          callback
        ) => {
          assert.strictEqual(method, 'test');
          assert(streamId != null);
          cb = callback;
        };
        let pushTime = 0;
        client.onStreamPush = (streamId, isEos, chunk) => {
          pushTime++;
          assert.strictEqual(chunk.toString(), 'foobar');
          if (pushTime === 2) {
            assert.strictEqual(isEos, true);
            const resp: aworker.ipc.ITriggerResponseMessage = {
              status: 200,
              metadata: {},
            };
            cb(CanonicalCode.OK, null, resp);
          }
        };

        assert(sessionId >= 0);
        const ret = server.trigger(sessionId, 'test', {}, false, true, 2000);

        const streamId = ret.sid;
        assert(streamId != null);

        let times = 2;
        const interval = setInterval(() => {
          times--;
          if (times === 0) {
            clearInterval(interval);
          }
          server.streamPush(
            sessionId,
            streamId!,
            times === 0,
            Buffer.from('foobar'),
            false
          );
        }, 1);

        const resp = await ret.future;
        assert.deepStrictEqual(resp, {
          status: 200,
          metadata: {
            headers: [],
          },
        });
      });

      it('should handle requests in loop ticks', async () => {
        createSimpleServer();
        await server.start();

        client = new NoslatedClient(serverPath, 'foobar');
        await client.start();

        const events: string[] = [];
        server.onRequest = (sid, op, params, callback) => {
          events.push(
            `${
              (params as aworker.ipc.IDaprInvokeRequestMessage).methodName
            } on request`
          );
          Promise.resolve().then(() => {
            events.push(
              `${
                (params as aworker.ipc.IDaprInvokeRequestMessage).methodName
              } microtask`
            );
            callback(CanonicalCode.OK, null, {
              status: 200,
              data: Buffer.from('foobar'),
            });
          });
        };
        client.onRequest = (
          method,
          streamId,
          metadata,
          hasInputData,
          hasOutputData,
          callback
        ) => {
          if (method !== 'test') {
            callback(CanonicalCode.CLIENT_ERROR);
            return;
          }

          Promise.all([
            client.daprInvoke('myAppId', 'method1', Buffer.from('data'), 1000),
            client.daprInvoke('myAppId', 'method2', Buffer.from('data'), 1000),
          ]).then(() => {
            const resp: aworker.ipc.ITriggerResponseMessage = {
              status: 200,
              metadata,
            };
            callback(CanonicalCode.OK, null, resp);
          });
        };

        assert(sessionId >= 0);
        const metadata = {
          url: 'http://example.com',
          method: 'GET',
          baggage: ['foo', 'bar'],
          headers: ['quz', 'qak'],
        };
        const ret = server.trigger(
          sessionId,
          'test',
          metadata,
          false,
          false,
          1000
        );

        assert(ret.sid == null);
        const resp = await ret.future;
        assert.deepStrictEqual(resp, {
          status: 200,
          metadata: {
            headers: [['quz', 'qak']],
          },
        });

        assert.deepStrictEqual(events, [
          'method1 on request',
          'method1 microtask',
          'method2 on request',
          'method2 microtask',
        ]);
      });
    });
  });

  describe('MessageParser', () => {
    it('should handle buffer upper bounds', () => {
      const parser = new MessageParser();
      const content = aworker.ipc.StreamPushRequestMessage.encode({
        sid: 1,
        isEos: false,
        data: Buffer.from('foobar'),
      }).finish();
      const header = aworker.ipc.MessageHeader.encode({
        code: CanonicalCode.OK,
        contentLength: content.byteLength,
        messageKind: aworker.ipc.MessageKind.Request,
        requestKind: aworker.ipc.RequestKind.StreamPush,
        requestId: 1,
      }).finish();

      // Create a underlying arraybuffer that greater than the actual content size.
      const block = Buffer.concat([
        Buffer.alloc(1000),
        header,
        content,
        Buffer.alloc(1000),
      ]);
      const view = Buffer.from(
        block.buffer,
        block.byteOffset + 1000,
        header.byteLength + content.byteLength
      );
      parser.push(view);
      const message = parser.next();
      assert(message != null);
      assert.strictEqual(message.code, CanonicalCode.OK);
      assert.strictEqual(message.kind, aworker.ipc.MessageKind.Request);
      assert.strictEqual(
        message.requestKind,
        aworker.ipc.RequestKind.StreamPush
      );
      assert.strictEqual(message.requestId, 1);
      assert.strictEqual(
        Buffer.from(
          aworker.ipc.StreamPushRequestMessage.encode(message.content).finish()
        ).compare(content),
        0
      );

      // Assert the parser has drained the buffers.
      assert.strictEqual(parser['_bufs'].length, 0);
    });
  });
});
