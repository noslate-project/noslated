import { ControlPanelMetricAttributes, PanelMetricAttributes, ControlPanelMetrics } from '#self/lib/telemetry/semantic_conventions';
import { turf } from '#self/lib/turf';
import { TurfContainerStates } from '#self/lib/turf';
import { TurfState } from '#self/lib/turf/types';
import { Meter, ValueObserver, Counter, BatchObserverResult, Labels, Observation } from '@opentelemetry/api';
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

  #cpuUserValueObserver: ValueObserver;
  #cpuSystemValueObserver: ValueObserver;
  #rssValueObserver: ValueObserver;
  #vmValueObserver: ValueObserver;
  #funcExitCounter: Counter;
  #replicaTotalCountValueObserver: ValueObserver;

  constructor(meter: Meter, workerStatsSnapshot: WorkerStatsSnapshot) {
    this.#meter = meter;
    this.#workerStatsSnapshot = workerStatsSnapshot;
    this.#workerStatsSnapshot.on('workerStopped', this.onWorkerStopped);
    this.#cpuUserValueObserver = this.#meter.createValueObserver(ControlPanelMetrics.REPLICA_CPU_USER);
    this.#cpuSystemValueObserver = this.#meter.createValueObserver(ControlPanelMetrics.REPLICA_CPU_SYSTEM);
    this.#rssValueObserver = this.#meter.createValueObserver(ControlPanelMetrics.REPLICA_MEM_RSS);
    this.#vmValueObserver = this.#meter.createValueObserver(ControlPanelMetrics.REPLICA_MEM_VM);
    this.#funcExitCounter = this.#meter.createCounter(ControlPanelMetrics.FUNCTION_REPLICA_EXIT_COUNT);
    this.#replicaTotalCountValueObserver = this.#meter.createValueObserver(ControlPanelMetrics.FUNCTION_REPLICA_TOTAL_COUNT);

    // Latest OpenTelemetry Meter#createBatchObserver doesn't require name as
    // first parameter
    // TODO: 更新 OpenTelemetry 后统一写法
    if (this.#meter.createBatchObserver.length === 1) {
      (this.#meter as any).createBatchObserver(async (batchObserverResult: BatchObserverResult) => {
        const series = await this.onObservation();
        series.forEach(({ labels, observations }) => {
          batchObserverResult.observe(labels, observations);
        });
      });
    } else {
      // The name parameter is actually no meaning.
      this.#meter.createBatchObserver('noslate.control.batch_observer', async batchObserverResult => {
        const series = await this.onObservation();
        series.forEach(({ labels, observations }) => {
          batchObserverResult.observe(labels, observations);
        });
      });
    }
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
      [PanelMetricAttributes.FUNCTION_NAME]: `${functionName}`,
      [ControlPanelMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
      [ControlPanelMetricAttributes.EXIT_CODE]: `${state?.exitcode ?? ''}`,
      [ControlPanelMetricAttributes.EXIT_SIGNAL]: `${state?.['killed.signal'] ?? ''}`,
      [ControlPanelMetricAttributes.EXIT_REASON]: mapStateToExitReason(state),
    });
  }

  onObservation = async () => {
    const observations: ObservationItem[] = [];
    await Promise.all(Array.from(this.#workerStatsSnapshot.brokers.values()).flatMap(broker => {
      const functionName = broker.name;
      const runtimeType = broker.data?.runtime;
      if (runtimeType == null) {
        return [];
      }

      const totalCount = broker.workers.size;
      observations.push({
        labels: {
          [PanelMetricAttributes.FUNCTION_NAME]: `${functionName}`,
          [ControlPanelMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
        },
        observations: [
          this.#replicaTotalCountValueObserver.observation(totalCount),
        ],
      });

      if (process.platform !== 'linux') {
        // Not supported
        return [];
      }
      return Array.from(broker.workers.values()).map(async worker => {
        const state = await turf.state(worker.name).catch(() => ({ state: TurfContainerStates.unknown }));
        if (state.state !== TurfContainerStates.running) {
          return;
        }
        observations.push({
          labels: {
            [PanelMetricAttributes.FUNCTION_NAME]: `${functionName}`,
            [ControlPanelMetricAttributes.PROCESS_PID]: `${state.pid}`,
            [ControlPanelMetricAttributes.RUNTIME_TYPE]: `${runtimeType}`,
          },
          observations: [
            this.#cpuUserValueObserver.observation(state['stat.utime']),
            this.#cpuSystemValueObserver.observation(state['stat.stime']),
            this.#rssValueObserver.observation(state['stat.rss']),
            this.#vmValueObserver.observation(state['stat.vsize']),
          ],
        });
      });
    }));

    return observations;
  }
}

interface ObservationItem {
  labels: Labels;
  observations: Observation[];
}
