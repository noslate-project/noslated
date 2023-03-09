import {
  Worker,
  Broker,
  WorkerMetadata,
  WorkerStatsSnapshot,
} from '../worker_stats/index';

type WorkerDesc = {
  processName: string;
  credential: string;
} & Partial<WorkerMetadata>;

export function registerWorkers(
  brokerOrSnapshot: Broker | WorkerStatsSnapshot,
  workerMetadatas: WorkerDesc[]
) {
  const workers: Worker[] = [];

  for (const data of workerMetadatas) {
    if (brokerOrSnapshot instanceof Broker) {
      const workerMetadata = new WorkerMetadata(
        data.funcName ?? brokerOrSnapshot.name,
        {
          inspect: data.options?.inspect ?? brokerOrSnapshot.isInspector,
        },
        data.disposable ?? brokerOrSnapshot.disposable,
        data.toReserve ?? false,
        data.processName!,
        data.credential!
      );
      workers.push(brokerOrSnapshot.register(workerMetadata));
    } else if (brokerOrSnapshot instanceof WorkerStatsSnapshot) {
      const workerMetadata = new WorkerMetadata(
        data.funcName!,
        {
          inspect: data.options?.inspect ?? false,
        },
        data.disposable ?? false,
        data.toReserve ?? false,
        data.processName!,
        data.credential!
      );
      workers.push(brokerOrSnapshot.register(workerMetadata));
    }
  }
  return workers;
}
