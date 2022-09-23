import assert from 'assert';
import otel from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/metrics';

import { turf } from '#self/lib/turf';
import { bufferFromStream } from '#self/lib/util';
import {
  PanelMetricAttributes,
  WorkerMetrics,
  WorkerMetricsAttributes,
} from '#self/lib/telemetry/semantic_conventions';

import { daemonProse, TelemetryContext, ProseContext } from '#self/test/util';
import * as common from '#self/test/common';
import { TestProcessor, forceExport, getMetricRecords, nodeJsWorkerTestItem, serverlessWorkerTestItem } from '#self/test/telemetry-util';
import { TurfContainerStates } from '#self/lib/turf';

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
    /** @type {import('#self/data_panel/data_panel').DataPanel} */
    data: undefined,
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

  [
    [ 'Node.js Worker', nodeJsWorkerTestItem ],
    [ 'Serverless Worker', serverlessWorkerTestItem ],
  ].forEach(([ name, testItem ]: any[]) => {
    it(`collect ${name} metrics`, async () => {
      const { agent, meterProvider, processor, data: dataPanel } = context;

      await agent!.setFunctionProfile([ testItem.profile ]);

      const data = Buffer.from('foobar');
      const response = await agent!.invoke(testItem.name, data);
      await bufferFromStream(response as any);

      const broker = Array.from(dataPanel!.dataFlowController.brokers.values()!)[0];
      assert.ok(broker != null);
      assert.strictEqual(broker.name, testItem.name);
      const worker = broker.workers[0];
      assert.ok(worker != null);
      // TODO(chengzhong.wcz): get pid from worker stats.
      // const pid = worker.pid;
      // assert.ok(pid != null);
      const items = await turf.ps();
      const state = items.filter((it: { status: TurfContainerStates; name: string; }) => {
        return it.status === TurfContainerStates.running && it.name === worker.name;
      })[0];
      assert.ok(state != null);
      const pid = state.pid;

      await forceExport(meterProvider!);
      await forceExport(meterProvider!);
      {
        const records = getMetricRecords(processor!, WorkerMetrics.TOTAL_HEAP_SIZE, {
          [PanelMetricAttributes.FUNCTION_NAME]: testItem.name,
          [WorkerMetricsAttributes.WORKER_PID]: `${pid}`,
        });
        assert.strictEqual(records.length, 1);
      }

      {
        const records = getMetricRecords(processor!, WorkerMetrics.USED_HEAP_SIZE, {
          [PanelMetricAttributes.FUNCTION_NAME]: testItem.name,
          [WorkerMetricsAttributes.WORKER_PID]: `${pid}`,
        });
        assert.strictEqual(records.length, 1);
      }
    });
  });
});
