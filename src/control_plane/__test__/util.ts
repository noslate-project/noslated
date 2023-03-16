import { Broker } from '../worker_stats/broker';
import { StateManager } from '../worker_stats/state_manager';
import { WorkerMetadata, Worker } from '../worker_stats/worker';

type WorkerDesc = {
  processName: string;
  credential: string;
} & Partial<WorkerMetadata>;

export function registerWorkers(
  brokerOrManager: Broker | StateManager,
  workerMetadatas: WorkerDesc[]
) {
  const workers: Worker[] = [];

  for (const data of workerMetadatas) {
    if (brokerOrManager instanceof Broker) {
      const workerMetadata = new WorkerMetadata(
        data.funcName ?? brokerOrManager.name,
        {
          inspect: data.options?.inspect ?? brokerOrManager.isInspector,
        },
        data.toReserve ?? false,
        data.processName!,
        data.credential!
      );
      workers.push(brokerOrManager.register(workerMetadata));
    } else if (brokerOrManager instanceof StateManager) {
      const workerMetadata = new WorkerMetadata(
        data.funcName!,
        {
          inspect: data.options?.inspect ?? false,
        },
        data.toReserve ?? false,
        data.processName!,
        data.credential!
      );
      workers.push(brokerOrManager.register(workerMetadata));
    }
  }
  return workers;
}
