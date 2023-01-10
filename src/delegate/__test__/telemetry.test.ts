import assert from 'assert';
import { metrics } from '@opentelemetry/api';
import { Histogram, MeterProvider } from '@opentelemetry/sdk-metrics';
import { bufferFromStream } from '#self/lib/util';
import {
  DelegateMetrics,
  DelegateMetricAttributes,
} from '#self/lib/telemetry/semantic_conventions';

import * as common from '#self/test/common';
import {
  TestMetricReader,
  getMetricRecords,
  nodeJsWorkerTestItem,
} from '#self/test/telemetry-util';
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

  it('invoke with delegate metrics', async () => {
    await env.agent.setFunctionProfile([nodeJsWorkerTestItem.profile]);

    const data = Buffer.from('foobar');
    const startTime = Date.now();
    const response = await env.agent.invoke(nodeJsWorkerTestItem.name, data);
    const endTime = Date.now();
    const buffer = await bufferFromStream(response!);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    const result = await metricReader.collect();
    {
      const records = getMetricRecords<number>(
        result,
        DelegateMetrics.TRIGGER_COUNT,
        { [DelegateMetricAttributes.TRIGGER_METHOD]: 'init' }
      );
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }

    {
      const records = getMetricRecords<number>(
        result,
        DelegateMetrics.TRIGGER_COUNT,
        { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' }
      );
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }

    {
      const records = getMetricRecords<Histogram>(
        result,
        DelegateMetrics.TRIGGER_DURATION,
        { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' }
      );
      assert.strictEqual(records.length, 1);
      common.assertApproxEquals(
        endTime - startTime,
        records[0].value.sum!,
        1000
      );
    }
  });
});
