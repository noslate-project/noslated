import assert from 'assert';
import { once } from 'events';
import otel from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/metrics';
import { turf } from '#self/lib/turf';
import { bufferFromStream } from '#self/lib/util';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import {
  PanelMetricAttributes,
  ControlPanelMetrics,
  ControlPanelMetricAttributes,
} from '#self/lib/telemetry/semantic_conventions';
import { daemonProse, ProseContext, TelemetryContext } from '#self/test/util';
import * as common from '#self/test/common';
import { TestProcessor, forceExport, getMetricRecords, nodeJsWorkerTestItem } from '#self/test/telemetry-util';

describe(common.testName(__filename), function() {
  // Debug version of Node.js may take longer time to bootstrap.
  this.timeout(30_000);

  const context: ProseContext<TelemetryContext> = {
    agent: undefined,
    meterProvider: undefined,
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

  it('should collect replica metrics', async () => {
    const { agent, meterProvider, processor } = context;

    await agent!.setFunctionProfile([ nodeJsWorkerTestItem.profile ] as any);
    const data = Buffer.from('foobar');
    const response = await agent!.invoke(nodeJsWorkerTestItem.name, data);

    const buffer = await bufferFromStream(response!);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    // There is a bug in batch observer in 0.10.2
    // See https://github.com/open-telemetry/opentelemetry-js/pull/1470
    await forceExport(meterProvider!);
    await forceExport(meterProvider!);
    {
      const records = getMetricRecords(processor as any,
        ControlPanelMetrics.FUNCTION_REPLICA_TOTAL_COUNT,
        {
          [PanelMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPanelMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
        });

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].aggregator.toPoint().value, 1);
    }
  });

  const replicaResourceUsageProse = process.platform === 'linux' ? it : it.skip;
  replicaResourceUsageProse('should collect replica exit count', async () => {
    const { agent, control, meterProvider, processor }: any = context;

    await agent.setFunctionProfile([ nodeJsWorkerTestItem.profile ]);
    const data = Buffer.from('foobar');
    const response = await agent.invoke(nodeJsWorkerTestItem.name, data);
    const buffer = await bufferFromStream(response);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    const items = await turf.ps();
    items.filter((it: { status: TurfContainerStates; }) => {
      return it.status === TurfContainerStates.running;
    }).forEach((it: { pid: number; }) => {
      process.kill(it.pid, 'SIGKILL');
    });

    await once(control.capacityManager.workerStatsSnapshot, 'workerStopped');

    await forceExport(meterProvider);
    {
      const records = getMetricRecords(processor,
        ControlPanelMetrics.FUNCTION_REPLICA_EXIT_COUNT,
        {
          [PanelMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPanelMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
          [ControlPanelMetricAttributes.EXIT_CODE]: '',
          [ControlPanelMetricAttributes.EXIT_SIGNAL]: '9',
          [ControlPanelMetricAttributes.EXIT_REASON]: '',
        });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].aggregator.toPoint().value, 1);
    }
  });

  replicaResourceUsageProse('should collect replica resource usage', async () => {
    const { agent, control, meterProvider, processor }: any = context;

    await agent.setFunctionProfile([ nodeJsWorkerTestItem.profile ]);
    const data = Buffer.from('foobar');
    const response = await agent.invoke(nodeJsWorkerTestItem.name, data);
    const buffer = await bufferFromStream(response);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    const broker: any = Array.from(control.capacityManager.workerStatsSnapshot.brokers.values())[0];
    assert.ok(broker != null);
    assert.strictEqual(broker.name, nodeJsWorkerTestItem.name);
    const worker: any = Array.from(broker.workers.values())[0];
    assert.ok(worker != null);
    // TODO(chengzhong.wcz): get pid from worker stats.
    // const pid = worker.pid;
    // assert.ok(pid != null);
    const items = await turf.ps();
    const state = items.filter((it: { status: TurfContainerStates; name: any; }) => {
      return it.status === TurfContainerStates.running && it.name === worker.name;
    })[0];
    assert.ok(state != null);
    const pid = state.pid;

    // There is a bug in batch observer in 0.10.2
    // See https://github.com/open-telemetry/opentelemetry-js/pull/1470
    await forceExport(meterProvider);
    await forceExport(meterProvider);

    [
      ControlPanelMetrics.REPLICA_CPU_USER,
      ControlPanelMetrics.REPLICA_CPU_SYSTEM,
      ControlPanelMetrics.REPLICA_MEM_RSS,
      ControlPanelMetrics.REPLICA_MEM_VM,
    ].forEach(metric => {
      const records = getMetricRecords(processor,
        metric,
        {
          [PanelMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPanelMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
          [ControlPanelMetricAttributes.PROCESS_PID]: `${pid}`,
        });
      assert.strictEqual(records.length, 1, `expect ${metric}`);
      assert.ok(records[0].aggregator.toPoint().value >= 0, `expect ${metric} value`);
    });
  });
});
