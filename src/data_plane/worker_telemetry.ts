import { Meter, ValueObserver, BatchObserverResult, Labels, Observation } from '@opentelemetry/api';
import { WorkerMetrics, PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { AliceDelegateService } from '#self/delegate';
import { DataFlowController } from './data_flow_controller';
const logger = require('#self/lib/logger').get('worker telemetry');

export class WorkerTelemetry {
  #meter: Meter;
  #delegate: AliceDelegateService;
  #dataFlowController: DataFlowController;
  #observerMap: Map<string, ValueObserver>  = new Map();

  constructor(meter: Meter, delegate: AliceDelegateService, dataFlowController: DataFlowController) {
    this.#meter = meter;
    this.#delegate = delegate;
    this.#dataFlowController = dataFlowController;

    this.#observerMap.set(WorkerMetrics.TOTAL_HEAP_SIZE, this.#meter.createValueObserver(WorkerMetrics.TOTAL_HEAP_SIZE));
    this.#observerMap.set(WorkerMetrics.USED_HEAP_SIZE, this.#meter.createValueObserver(WorkerMetrics.USED_HEAP_SIZE));

    // Latest OpenTelemetry Meter#createBatchObserver doesn't require name as
    // first parameter
    if (this.#meter.createBatchObserver.length === 1) {
      (this.#meter as any).createBatchObserver(async (batchObserverResult: BatchObserverResult) => {
        const series = await this.onObservation();
        series.forEach(({ labels, observations }) => {
          batchObserverResult.observe(labels, observations);
        });
      });
    } else {
      // The name parameter is actually no meaning.
      this.#meter.createBatchObserver('noslate.data.batch_observer', async batchObserverResult => {
        const series = await this.onObservation();
        series.forEach(({ labels, observations }) => {
          batchObserverResult.observe(labels, observations);
        });
      });
    }
  }

  onObservation = async () => {
    const observations: MetricItem[] = [];

    await Promise.all(Array.from(this.#dataFlowController.brokers.values()).flatMap(broker => {
      const functionName = broker.name;
      // TODO(chengzhong.wcz): runtime type;

      return broker.workers.map(async worker => {
        let metrics;
        try {
          metrics = await this.#delegate.collectMetrics(worker.credential);
        } catch (e) {
          logger.warn(`Failed to collect metrics for worker ${worker.name}.`, e);
          return null;
        }

        for (const item of (metrics?.integerRecords || [])) {
          const observer = this.#observerMap.get(item.name);
          if (observer == null) {
            continue;
          }

          observations.push({
            labels: {
              ...item.labels,
              [PlaneMetricAttributes.FUNCTION_NAME]: functionName,
            },
            observations: [
              observer.observation(item.value as number),
            ],
          });
        }
      }).filter(o => o);
    }));

    return observations;
  }
}

interface MetricItem {
  labels: Labels;
  observations: Observation[];
}
