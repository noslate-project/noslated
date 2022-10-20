import loggers from '#self/lib/logger';
import { DataPlaneClientManager } from './manager';
import { DataPlaneClient } from './client';
import { ControlPlane } from '../control_plane';
import { Logger } from '#self/lib/loggers';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';
import { ContainerStatus } from '#self/lib/constants';

export class DataPlaneSubscription {
  static SubscriptionNames = [
    'requestQueueing',
    'workerTrafficStats',
    'containerStatusReport'
  ];

  plane: ControlPlane;
  logger: Logger;

  constructor(manager: DataPlaneClientManager, private client: DataPlaneClient) {
    this.client = client;
    this.plane = manager.plane;
    this.logger = loggers.get('data plane subscription');
  }

  async requestQueueing(requestQueueingRequest: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>) {
    const plane = this.plane;
    const { capacityManager } = plane;
    this.logger.info('received request queueing event (requestId: %s) for func(%s, inspect %s) with request count %d',
      requestQueueingRequest.requestId,
      requestQueueingRequest.name,
      requestQueueingRequest.isInspect,
      requestQueueingRequest.queuedRequestCount
    );

    try {
      await capacityManager.expandDueToQueueingRequest(this.client, requestQueueingRequest);
    } catch (e) {
      this.logger.error(`Failed to deal with queueing request. name: ${requestQueueingRequest.name}, requestId: ${requestQueueingRequest.requestId}`, e);
    }
  }

  async workerTrafficStats(snapshot: root.noslated.data.WorkerTrafficStatsSnapshot) {
    const { plane: { capacityManager } } = this;

    try {
      await capacityManager.syncWorkerData(snapshot.brokers);
      await capacityManager.autoScale();
    } catch (e) {
      this.logger.error('Failed to process capacityManager.syncWorkerData / capacityManager.autoScale', e);
    }
  }

  async containerStatusReport(report: NotNullableInterface<root.noslated.data.IContainerStatusReport>) {
    const plane = this.plane;
    const { capacityManager } = plane;


    const { functionName, name, event, isInspector } = report;

    const broker = capacityManager.workerStatsSnapshot.getBroker(functionName, isInspector);
    const worker = capacityManager.workerStatsSnapshot.getWorker(functionName, isInspector, name);

    if (!broker || !worker) {
      this.logger.warn('containerStatusReport report [%o] skip because no broker and worker related.', report);
      return;
    }

    plane.stateManager.updateContainerStatusByReport(worker, report);

    // 如果已经 ready，则从 starting pool 中移除
    if (worker.containerStatus === ContainerStatus.Ready) {
      broker.removeItemFromStartingPool(worker.name);
    }

    try {
      await plane.disposableController.stopDisposableWorkerByEvent(worker, event, report.requestId);
    } catch (error) {
      this.logger.error(`Failed to process containerStatusReport [${JSON.stringify(report)}].`, error);
    }
  }

  /**
   * Subscribe Data Plane's broadcasting
   */
  subscribe() {
    for (const name of DataPlaneSubscription.SubscriptionNames) {
      this.client.subscribe(name, params => {
        try {
          this[name].call(this, params);
        } catch (e) {
          // log to file.
          this.logger.error('[FATAL] uncaughtException:', e);
          process.nextTick(() => { throw e; });
        }
      });
    }
  }
}
