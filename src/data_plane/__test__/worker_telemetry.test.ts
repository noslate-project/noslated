import assert from 'assert';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

import { bufferFromStream } from '#self/lib/util';
import {
  PlaneMetricAttributes,
  WorkerMetrics,
  WorkerMetricsAttributes,
} from '#self/lib/telemetry/semantic_conventions';

import * as common from '#self/test/common';
import {
  TestMetricReader,
  getMetricRecords,
  nodeJsWorkerTestItem,
  serverlessWorkerTestItem,
} from '#self/test/telemetry-util';
import { TurfContainerStates } from '#self/lib/turf';
import { DefaultEnvironment } from '#self/test/env/environment';

describe(common.testName(__filename), function () {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  let meterProvider: MeterProvider;
  let metricReader: TestMetricReader;
  beforeEach(async () => {
    metricReader = new TestMetricReader();
    meterProvider = new MeterProvider();
    meterProvider.addMetricReader(metricReader);
    metrics.setGlobalMeterProvider(meterProvider);
  });
  afterEach(() => {
    // disable current global provider so that we can set global meter provider again.
    metrics.disable();
  });
  const env = new DefaultEnvironment();

  [
    ['Node.js Worker', nodeJsWorkerTestItem],
    ['Serverless Worker', serverlessWorkerTestItem],
  ].forEach(([name, testItem]: any[]) => {
    it(`collect ${name} metrics`, async () => {
      await env.agent.setFunctionProfile([testItem.profile]);

      const data = Buffer.from('foobar');
      const response = await env.agent.invoke(testItem.name, data);
      await bufferFromStream(response);

      const broker = Array.from(
        env.data.dataFlowController.brokers.values()!
      )[0];
      assert.ok(broker != null);
      assert.strictEqual(broker.name, testItem.name);
      const worker = broker.workers[0];
      assert.ok(worker != null);
      // TODO(chengzhong.wcz): get pid from worker stats.
      // const pid = worker.pid;
      // assert.ok(pid != null);
      const items = await env.control.turf.ps();
      const state = items.filter(
        (it: { status: TurfContainerStates; name: string }) => {
          return (
            it.status === TurfContainerStates.running && it.name === worker.name
          );
        }
      )[0];
      assert.ok(state != null);
      const pid = state.pid;

      const result = await metricReader.collect();
      {
        const records = getMetricRecords<number>(
          result,
          WorkerMetrics.TOTAL_HEAP_SIZE,
          {
            [PlaneMetricAttributes.FUNCTION_NAME]: testItem.name,
            [WorkerMetricsAttributes.WORKER_PID]: `${pid}`,
          }
        );
        assert.strictEqual(records.length, 1);
      }

      {
        const records = getMetricRecords<number>(
          result,
          WorkerMetrics.USED_HEAP_SIZE,
          {
            [PlaneMetricAttributes.FUNCTION_NAME]: testItem.name,
            [WorkerMetricsAttributes.WORKER_PID]: `${pid}`,
          }
        );
        assert.strictEqual(records.length, 1);
      }
    });
  });
});
