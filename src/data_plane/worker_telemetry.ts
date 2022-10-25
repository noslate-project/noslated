import { BatchObservableResult, Meter, ObservableGauge } from '@opentelemetry/api-metrics';
import { WorkerMetrics, PlaneMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { NoslatedDelegateService } from '#self/delegate';
import { DataFlowController } from './data_flow_controller';
const logger = require('#self/lib/logger').get('worker telemetry');

export class WorkerTelemetry {
  #meter: Meter;
  #delegate: NoslatedDelegateService;
  #dataFlowController: DataFlowController;
  #observables: Map<string, ObservableGauge>  = new Map();

  constructor(meter: Meter, delegate: NoslatedDelegateService, dataFlowController: DataFlowController) {
    this.#meter = meter;
    this.#delegate = delegate;
    this.#dataFlowController = dataFlowController;

    this.#observables.set(WorkerMetrics.TOTAL_HEAP_SIZE, this.#meter.createObservableGauge(WorkerMetrics.TOTAL_HEAP_SIZE));
    this.#observables.set(WorkerMetrics.USED_HEAP_SIZE, this.#meter.createObservableGauge(WorkerMetrics.USED_HEAP_SIZE));

    this.#meter.addBatchObservableCallback(this.onObservation, Array.from(this.#observables.values()));
  }

  onObservation = async (batchObservableResult: BatchObservableResult) => {
    await Promise.all(Array.from(this.#dataFlowController.brokers.values()).flatMap(broker => {
      const functionName = broker.name;
      // TODO(chengzhong.wcz): runtime type;

      return broker.workers.map(async worker => {
        let metrics;
        try {
          metrics = await this.#delegate.collectMetrics(worker.credential);
        } catch (e) {
          logger.warn(`Failed to collect metrics for worker ${worker.name}.`, e);
          return;
        }

        for (const item of (metrics?.integerRecords || [])) {
          const observable = this.#observables.get(item.name);
          if (observable == null) {
            continue;
          }

          batchObservableResult.observe(observable, item.value, {
            ...item.labels,
            [PlaneMetricAttributes.FUNCTION_NAME]: functionName,
          });
        }
      })
    }));
  }
}
