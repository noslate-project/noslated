import assert from 'assert';
import { metrics } from '@opentelemetry/api';
import { Histogram, MeterProvider } from '@opentelemetry/sdk-metrics';
import { bufferFromStream } from '#self/lib/util';
import {
  DelegateMetrics,
  DelegateMetricAttributes,
} from '#self/lib/telemetry/semantic_conventions';

import * as common from '#self/test/common';
import { daemonProse, ProseContext, TelemetryContext } from '#self/test/util';
import { TestMetricReader, getMetricRecords, nodeJsWorkerTestItem } from '#self/test/telemetry-util';

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const context: ProseContext<TelemetryContext> = {
    meterProvider: undefined,
    metricReader: undefined,
  };

  beforeEach(async () => {
    context.metricReader = new TestMetricReader();
    context.meterProvider = new MeterProvider();
    context.meterProvider.addMetricReader(context.metricReader!);
    metrics.setGlobalMeterProvider(context.meterProvider);
  });
  afterEach(() => {
    // disable current global provider so that we can set global meter provider again.
    metrics.disable();
  });
  daemonProse(context);

  it('invoke with delegate metrics', async () => {
    const { agent, metricReader } = context;

    await agent!.setFunctionProfile([ nodeJsWorkerTestItem.profile ] as any);

    const data = Buffer.from('foobar');
    const startTime = Date.now();
    const response = await agent?.invoke(nodeJsWorkerTestItem.name, data);
    const endTime = Date.now();
    const buffer = await bufferFromStream(response!);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    const result = await metricReader!.collect();
    {
      const records = getMetricRecords<number>(result, DelegateMetrics.TRIGGER_COUNT, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'init' });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }

    {
      const records = getMetricRecords<number>(result, DelegateMetrics.TRIGGER_COUNT, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }

    {
      const records = getMetricRecords<Histogram>(result, DelegateMetrics.TRIGGER_DURATION, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' });
      assert.strictEqual(records.length, 1);
      common.assertApproxEquals(endTime - startTime, records[0].value.sum!, 1000);
    }
  });
});
