import assert from 'assert';
import * as common from '../common';
import { DefaultEnvironment } from '../env/environment';
import { bufferFromStream, sleep } from '#self/lib/util';
import { findResponseHeaderValue } from '../util';
import sinon from 'sinon';
import { Worker } from '#self/data_plane/worker_broker';
import { Metadata } from '#self/delegate/request_response';
import { once } from 'events';

describe(common.testName(__filename), () => {
  const env = new DefaultEnvironment();

  it('should stop worker after invoke success', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    const resp = await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
      method: 'POST',
    });
    await bufferFromStream(resp);

    const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
    const dpWorker = Array.from(dpBroker.workers())[0];

    assert.strictEqual(dpWorker.trafficOff, true);

    await sleep(1000);

    assert.strictEqual(dpBroker.workerCount, 0);
  });

  it('should maxActivateRequests = 1 when disposable = true', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    const workerIds = new Set();

    await Promise.all([
      env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      }),
      env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      }),
      env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      }),
    ]).then(results => {
      for (const result of results) {
        const value = findResponseHeaderValue(result, 'x-noslate-worker-id');

        if (value) {
          workerIds.add(value);
        }
      }
    });

    assert.strictEqual(workerIds.size, 3);

    const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;

    await sleep(1000);

    assert.strictEqual(dpBroker.workerCount, 0);
  });

  it('should stop worker after invoke fail', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_echo`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    const stub = sinon.stub(Worker.prototype, 'invoke').callsFake(async () => {
      throw new Error('MockWorkerPipeError');
    });

    await assert.rejects(async () => {
      await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      });
    }, /MockWorkerPipeError/);

    const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
    const dpWorker = Array.from(dpBroker.workers())[0];

    assert.strictEqual(dpWorker.trafficOff, true);

    await sleep(1000);

    assert.strictEqual(dpBroker.workerCount, 0);

    stub.restore();
  });

  it('should dec activeRequestCount to 1 after invoke timeout', async function () {
    this.timeout(10_000);
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_echo',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_error`,
        sourceFile: 'no_response.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    await assert.rejects(async () => {
      await env.agent.invoke('aworker_echo', Buffer.from('ok'), {
        method: 'POST',
      });
    }, /Request Timeout/);

    const dpBroker = env.data.dataFlowController.getBroker('aworker_echo')!;
    const dpWorker = Array.from(dpBroker.workers())[0];

    await sleep(2000);
    // 需等待事件同步
    assert.strictEqual(dpWorker.activeRequestCount, 0);
  });

  it('should wait response sent', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_huge_response',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_huge_response`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    const size = 1024 * 1024 * 5;

    const response = await env.agent.invoke(
      'aworker_huge_response',
      Buffer.from(String(size)),
      {
        method: 'POST',
      }
    );

    const responseSizeStr =
      findResponseHeaderValue(response, 'x-response-size') || '';
    const responseSize = parseInt(responseSizeStr, 10);

    const data = await bufferFromStream(response);

    assert.strictEqual(data.length, responseSize);

    const dpBroker = env.data.dataFlowController.getBroker(
      'aworker_huge_response'
    )!;
    const dpWorker = Array.from(dpBroker.workers())[0];

    assert.strictEqual(dpWorker.trafficOff, true);

    await sleep(1000);

    assert.strictEqual(dpBroker.workerCount, 0);
  });

  it('should stop worker when response sent fail', async () => {
    await env.agent.setFunctionProfile([
      {
        name: 'aworker_huge_response',
        runtime: 'aworker',
        url: `file://${common.baselineDir}/aworker_huge_response`,
        sourceFile: 'index.js',
        signature: 'md5:234234',
        worker: {
          maxActivateRequests: 10,
          disposable: true,
        },
      },
    ]);

    const size = 1024 * 1024 * 8;

    const response = await env.agent.invoke(
      'aworker_huge_response',
      Buffer.from(String(size)),
      new Metadata({})
    );

    response.destroy();
    await once(response, 'close');

    const dpBroker = env.data.dataFlowController.getBroker(
      'aworker_huge_response'
    )!;
    const dpWorker = Array.from(dpBroker.workers())[0];
    assert.strictEqual(dpWorker.trafficOff, true);

    await sleep(1000);

    assert.strictEqual(dpBroker.workerCount, 0);
  });
});
