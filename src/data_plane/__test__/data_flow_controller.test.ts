import { bufferFromStream, sleep } from '#self/lib/util';
import * as common from '#self/test/common';
import { DefaultEnvironment } from '#self/test/env/environment';
import sinon from 'sinon';
import assert from 'assert';
import { Metadata } from '#self/delegate/request_response';
import { TriggerErrorStatus } from '../request_logger';

const { baselineDir } = common;

describe(common.testName(__filename), () => {
  describe('request logger', () => {
    const env = new DefaultEnvironment();

    let accessSpy: sinon.SinonSpy;
    let accessErrorSpy: sinon.SinonSpy;

    let requestId: string;
    let metadata: Metadata;
    let seq = 1;

    beforeEach(() => {
      accessSpy = sinon.spy(
        env.data.dataFlowController.requestLogger,
        'access'
      );
      accessErrorSpy = sinon.spy(
        env.data.dataFlowController.requestLogger,
        'error'
      );
      requestId = Date.now() + '' + seq++;
      metadata = new Metadata({
        method: 'POST',
        requestId,
      });
    });

    afterEach(() => {
      accessSpy.restore();
      accessErrorSpy.restore();
    });

    it('should log request by push_server invoke function', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      const response = await env.agent.invoke(
        'aworker_echo',
        Buffer.from('foobar'),
        metadata
      );

      const responseBuffer = await bufferFromStream(response);

      assert(assertAccessCalled(accessSpy, 'aworker_echo', requestId, '200'));

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });

    it('should log request by push_server invoke function error', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_error_sync_uncaught',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_error`,
          sourceFile: 'sync_uncaught.js',
          signature: 'md5:234234',
        },
      ]);

      await assert.rejects(async () => {
        try {
          await env.agent.invoke(
            'aworker_error_sync_uncaught',
            Buffer.from('foobar'),
            metadata
          );
        } catch (error) {
          assert(
            assertAccessCalled(
              accessSpy,
              'aworker_error_sync_uncaught',
              requestId,
              String(TriggerErrorStatus.INTERNAL)
            )
          );
          assert(
            assertAccessErrorCalled(
              accessErrorSpy,
              'aworker_error_sync_uncaught',
              requestId
            )
          );
          throw error;
        }
      }, /CanonicalCode::INTERNAL_ERROR/);
    });

    it('should log request by push_server invoke function then send response error', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_stream',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_stream`,
          sourceFile: 'concurrency.js',
          signature: 'md5:234234',
        },
      ]);

      const response = await env.agent.invoke(
        'aworker_stream',
        Buffer.from('foobar'),
        metadata
      );

      response.on('data', chunk => {
        console.log('first chunk: ', chunk);
      });

      await new Promise<void>(resolve => {
        setTimeout(() => {
          response.destroy();
          resolve();
        }, 500);
      });

      // wait log write
      await sleep(10);

      assert(
        assertAccessCalled(
          accessSpy,
          'aworker_stream',
          requestId,
          String(TriggerErrorStatus.ABORT)
        )
      );
      assert(
        assertAccessErrorCalled(accessErrorSpy, 'aworker_stream', requestId)
      );
    });

    it('should log request by push_server invoke service', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      await env.agent.setServiceProfile([
        {
          name: 'aworker',
          type: 'default',
          selector: {
            functionName: 'aworker_echo',
          },
        },
      ]);

      const response = await env.agent.invokeService(
        'aworker',
        Buffer.from('foobar'),
        metadata
      );

      const responseBuffer = await bufferFromStream(response);

      assert(
        assertAccessCalled(accessSpy, 'aworker:aworker_echo', requestId, '200')
      );

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });

    it('should log request by data_flow_controller invoke function', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      const response = await env.data.dataFlowController.invoke(
        'aworker_echo',
        Buffer.from('foobar'),
        metadata
      );

      const responseBuffer = await bufferFromStream(response);

      assert(assertAccessCalled(accessSpy, 'aworker_echo', requestId, '200'));

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });

    it('should log request by data_flow_controller invoke function error', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_error_sync_uncaught',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_error`,
          sourceFile: 'sync_uncaught.js',
          signature: 'md5:234234',
        },
      ]);

      await assert.rejects(async () => {
        try {
          await env.data.dataFlowController.invoke(
            'aworker_error_sync_uncaught',
            Buffer.from('foobar'),
            metadata
          );
        } catch (error) {
          assert(
            assertAccessCalled(
              accessSpy,
              'aworker_error_sync_uncaught',
              requestId,
              String(TriggerErrorStatus.INTERNAL)
            )
          );
          assert(
            assertAccessErrorCalled(
              accessErrorSpy,
              'aworker_error_sync_uncaught',
              requestId
            )
          );
          throw error;
        }
      }, /CanonicalCode::INTERNAL_ERROR/);
    });

    it('should log request by data_flow_controller invoke function then send response error', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_stream',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_stream`,
          sourceFile: 'concurrency.js',
          signature: 'md5:234234',
        },
      ]);

      const response = await env.data.dataFlowController.invoke(
        'aworker_stream',
        Buffer.from('foobar'),
        metadata
      );

      response.on('data', chunk => {
        console.log('first chunk: ', chunk);
      });

      await new Promise<void>(resolve => {
        setTimeout(() => {
          response.destroy(new Error('mock abort'));
          resolve();
        }, 500);
      });

      // wait log write
      await sleep(10);

      assert(
        assertAccessCalled(
          accessSpy,
          'aworker_stream',
          requestId,
          String(TriggerErrorStatus.ABORT)
        )
      );
      assert(
        assertAccessErrorCalled(accessErrorSpy, 'aworker_stream', requestId)
      );
    });

    it('should log request by data_flow_controller invoke service', async () => {
      await env.agent.setFunctionProfile([
        {
          name: 'aworker_echo',
          runtime: 'aworker',
          url: `file://${baselineDir}/aworker_echo`,
          sourceFile: 'index.js',
          signature: 'md5:234234',
        },
      ]);

      await env.agent.setServiceProfile([
        {
          name: 'aworker',
          type: 'default',
          selector: {
            functionName: 'aworker_echo',
          },
        },
      ]);

      const response = await env.data.dataFlowController.invokeService(
        'aworker',
        Buffer.from('foobar'),
        metadata
      );

      const responseBuffer = await bufferFromStream(response);

      assert(
        assertAccessCalled(accessSpy, 'aworker:aworker_echo', requestId, '200')
      );

      assert.strictEqual(responseBuffer.toString(), 'foobar');
    });
  });
});

const integerMatcher = sinon.match.number.and(
  sinon.match((value: number) => {
    return value >= 0;
  })
);

function assertAccessCalled(
  spy: sinon.SinonSpy,
  invokeName: string,
  requestId: string,
  status: string
) {
  const funcName = invokeName.split(':').pop();

  return spy.calledOnceWith(
    // invoke functionName
    sinon.match(invokeName),
    // invoke workerName
    sinon.match(new RegExp(`${funcName}-\\w+`)),
    // metadata
    sinon.match.instanceOf(Metadata).and(
      sinon.match((value: Metadata) => {
        return value.requestId === requestId;
      })
    ),
    // status
    sinon.match(status),
    // timing
    sinon.match
      .hasOwn('rt', integerMatcher)
      .and(sinon.match.hasOwn('ttfb', integerMatcher))
      .and(sinon.match.hasOwn('queueing', integerMatcher)),
    // bytesSent
    integerMatcher
  );
}

function assertAccessErrorCalled(
  spy: sinon.SinonSpy,
  invokeName: string,
  requestId: string
) {
  const funcName = invokeName.split(':').pop();
  const result = spy.calledOnceWith(
    // invoke functionName
    sinon.match(invokeName),
    // invoke workerName
    sinon.match(new RegExp(`${funcName}-\\w+`)),
    sinon.match.instanceOf(Error),
    sinon.match(requestId)
  );
  return result;
}
