import { ControlPlaneMetricAttributes, PlaneMetricAttributes, ControlPlaneMetrics } from '#self/lib/telemetry/semantic_conventions';
import { Turf, TurfContainerStates } from '#self/lib/turf';
import { TurfState } from '#self/lib/turf/types';
import { Meter, Counter, ObservableGauge, BatchObservableResult } from '@opentelemetry/api';
import { Broker, WorkerStatsSnapshot } from './worker_stats';

function mapStateToExitReason(state: TurfState | null): string {
  if (!state) return '';

  if (state['status.cpu_overload'] === '1') {
    return 'cpu_overload';
  }
  if (state['status.mem_overload'] === '1') {
    return 'mem_overload';
  }
  return '';
}

export class WorkerTelemetry {
  #meter: Meter;
  #workerStatsSnapshot: WorkerStatsSnapshot;

  #cpuUserValueObserver: ObservableGauge;
  #cpuSystemValueObserver: ObservableGauge;
  #rssValueObserver: ObservableGauge;
  #vmValueObserver: ObservableGauge;
  #funcExitCounter: Counter;
  #replicaTotalCountValueObserver: ObservableGauge;

  constructor(meter: Meter, workerStatsSnapshot: WorkerStatsSnapshot, private turf: Turf) {
    this.#meter = meter;
    this.#workerStatsSnapshot = workerStatsSnapshot;
    this.#workerStatsSnapshot.on('workerStopped', this.onWorkerStopped);
    this.#cpuUserValueObserver = this.#meter.createObservableGauge(ControlPlaneMetrics.REPLICA_CPU_USER);
    this.#cpuSystemValueObserver = this.#meter.createObservableGauge(ControlPlaneMetrics.REPLICA_CPU_SYSTEM);
    this.#rssValueObserver = this.#meter.createObservableGauge(ControlPlaneMetrics.REPLICA_MEM_RSS);
    this.#vmValueObserver = this.#meter.createObservableGauge(ControlPlaneMetrics.REPLICA_MEM_VM);
    this.#funcExitCounter = this.#meter.createCounter(ControlPlaneMetrics.FUNCTION_REPLICA_EXIT_COUNT);
    this.#replicaTotalCountValueObserver = this.#meter.createObservableGauge(ControlPlaneMetrics.FUNCTION_REPLICA_TOTAL_COUNT);

    this.#meter.addBatchObservableCallback(this.onObservation, [
      this.#cpuUserValueObserver,
      this.#cpuSystemValueObserver,
      this.#rssValueObserver,
      this.#vmValueObserver,
      this.#replicaTotalCountValueObserver,
    ]);
  }

  onWorkerStopped = (emitExceptionMessage: string | undefined, state: TurfState | null, broker: Broker) => {
    if (emitExceptionMessage) {
      return;
    }
    const functionName = broker.name;
    const runtimeType = broker.data?.runtime;
    if (runtimeType == null) {
      return;
    }

    this.#funcExitCounter.add(1, {
      [PlaneMetricAttributes.FUNCTION_NAME]: `${functionName}`,
      [ControlPlaneMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
      [ControlPlaneMetricAttributes.EXIT_CODE]: `${state?.exitcode ?? ''}`,
      [ControlPlaneMetricAttributes.EXIT_SIGNAL]: `${state?.['killed.signal'] ?? ''}`,
      [ControlPlaneMetricAttributes.EXIT_REASON]: mapStateToExitReason(state),
    });
  }

  onObservation = async (batchObservableResult: BatchObservableResult) => {
    await Promise.all(Array.from(this.#workerStatsSnapshot.brokers.values()).flatMap(broker => {
      const functionName = broker.name;
      const runtimeType = broker.data?.runtime;
      if (runtimeType == null) {
        return [];
      }

      const totalCount = broker.workers.size;
      batchObservableResult.observe(this.#replicaTotalCountValueObserver, totalCount, {
        [PlaneMetricAttributes.FUNCTION_NAME]: `${functionName}`,
        [ControlPlaneMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
      });

      if (process.platform !== 'linux') {
        // Not supported
        return [];
      }
      return Array.from(broker.workers.values()).map(async worker => {
        const state = await this.turf.state(worker.name).catch(() => ({ state: TurfContainerStates.unknown } as TurfState));
        if (state == null || state.state !== TurfContainerStates.running) {
          return;
        }
        const attributes = {
          [PlaneMetricAttributes.FUNCTION_NAME]: `${functionName}`,
          [ControlPlaneMetricAttributes.PROCESS_PID]: `${state.pid}`,
          [ControlPlaneMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
        };
        batchObservableResult.observe(this.#cpuUserValueObserver, state['stat.utime'], attributes);
        batchObservableResult.observe(this.#cpuSystemValueObserver, state['stat.stime'], attributes);
        batchObservableResult.observe(this.#rssValueObserver, state['stat.rss'], attributes);
        batchObservableResult.observe(this.#vmValueObserver, state['stat.vsize'], attributes);
      });
    }));
  }
}
