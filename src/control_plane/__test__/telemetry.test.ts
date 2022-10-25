import assert from 'assert';
import { once } from 'events';
import { metrics } from '@opentelemetry/api-metrics';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { turf } from '#self/lib/turf';
import { bufferFromStream } from '#self/lib/util';
import { TurfContainerStates } from '#self/lib/turf/wrapper';
import {
  PlaneMetricAttributes,
  ControlPlaneMetrics,
  ControlPlaneMetricAttributes,
} from '#self/lib/telemetry/semantic_conventions';
import { daemonProse, ProseContext, TelemetryContext } from '#self/test/util';
import * as common from '#self/test/common';
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
    context.meterProvider!.addMetricReader(context.metricReader!);
    metrics.setGlobalMeterProvider(context.meterProvider);
  });
  afterEach(() => {
    // disable current global provider so that we can set global meter provider again.
    metrics.disable();
  });
  daemonProse(context);

  it('should collect replica metrics', async () => {
    const { agent, metricReader } = context;

    await agent!.setFunctionProfile([ nodeJsWorkerTestItem.profile ] as any);
    const data = Buffer.from('foobar');
    const response = await agent!.invoke(nodeJsWorkerTestItem.name, data);

    const buffer = await bufferFromStream(response!);
    assert.strictEqual(buffer.toString('utf8'), 'foobar');

    const result = await metricReader!.collect();
    {
      const records = getMetricRecords<number>(result,
        ControlPlaneMetrics.FUNCTION_REPLICA_TOTAL_COUNT,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPlaneMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
        });

      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }
  });

  const replicaResourceUsageProse = process.platform === 'linux' ? it : it.skip;
  replicaResourceUsageProse('should collect replica exit count', async () => {
    const { agent, control, metricReader }: any = context;

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

    const result = await metricReader!.collect();
    {
      const records = getMetricRecords<number>(result,
        ControlPlaneMetrics.FUNCTION_REPLICA_EXIT_COUNT,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPlaneMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
          [ControlPlaneMetricAttributes.EXIT_CODE]: '',
          [ControlPlaneMetricAttributes.EXIT_SIGNAL]: '9',
          [ControlPlaneMetricAttributes.EXIT_REASON]: '',
        });
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].value, 1);
    }
  });

  replicaResourceUsageProse('should collect replica resource usage', async () => {
    const { agent, control, metricReader }: any = context;

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

    const result = await metricReader!.collect();

    [
      ControlPlaneMetrics.REPLICA_CPU_USER,
      ControlPlaneMetrics.REPLICA_CPU_SYSTEM,
      ControlPlaneMetrics.REPLICA_MEM_RSS,
      ControlPlaneMetrics.REPLICA_MEM_VM,
    ].forEach(metric => {
      const records = getMetricRecords<number>(result,
        metric,
        {
          [PlaneMetricAttributes.FUNCTION_NAME]: nodeJsWorkerTestItem.name,
          [ControlPlaneMetricAttributes.RUNTIME_TYPE]: nodeJsWorkerTestItem.profile.runtime,
          [ControlPlaneMetricAttributes.PROCESS_PID]: `${pid}`,
        });
      assert.strictEqual(records.length, 1, `expect ${metric}`);
      assert.ok(records[0].value >= 0, `expect ${metric} value`);
    });
  });
});
