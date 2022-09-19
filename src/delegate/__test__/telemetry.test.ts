import assert from 'assert';
import otel from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/metrics';
import { bufferFromStream } from '#self/lib/util';
import {
  DelegateMetrics,
  DelegateMetricAttributes,
} from '#self/lib/telemetry/semantic_conventions';

import * as common from '#self/test/common';
import { daemonProse, ProseContext, TelemetryContext } from '#self/test/util';
import { TestProcessor, forceExport, getMetricRecords, nodeJsWorkerTestItem } from '#self/test/telemetry-util';

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const context: ProseContext<TelemetryContext> = {
    /** @type {AliceAgent} */
    agent: undefined,
    /** @type {otel.MeterProvider} */
    meterProvider: undefined,
    /** @type {TestProcessor} */
    processor: undefined,
  };

  beforeEach(async () => {
    context.processor = new TestProcessor();
    // NOTE: Processor is named as Batcher in 0.10.2
    context.meterProvider = new MeterProvider({ batcher: context.processor } as any);
    otel.metrics.setGlobalMeterProvider(context.meterProvider);
  });
  afterEach(() => {
    // disable current global provider so that we can set global meter provider again.
    otel.metrics.disable();
  });
  daemonProse(context);

  it('invoke with delegate metrics', async () => {
    const { agent, meterProvider, processor } = context;

    await agent!.setFunctionProfile([ nodeJsWorkerTestItem.profile ] as any);

    const data = Buffer.from('foobar');
    const startTime = Date.now();
    const response = await agent?.invoke(nodeJsWorkerTestItem.name, data);
    const endTime = Date.now();
    const buffer = await bufferFromStream(response!);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    await forceExport(meterProvider!);
    {
      const records = getMetricRecords(processor!, DelegateMetrics.TRIGGER_COUNT, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'init' });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].aggregator.toPoint().value, 1);
    }

    {
      const records = getMetricRecords(processor!, DelegateMetrics.TRIGGER_COUNT, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].aggregator.toPoint().value, 1);
    }

    {
      const records = getMetricRecords(processor!, DelegateMetrics.TRIGGER_DURATION, { [DelegateMetricAttributes.TRIGGER_METHOD]: 'invoke' });
      assert.strictEqual(records.length, 1);
      common.assertApproxEquals(endTime - startTime, records[0].aggregator.toPoint().value, 1000);
    }
  });
});
