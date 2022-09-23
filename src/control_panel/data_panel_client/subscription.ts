import loggers from '#self/lib/logger';
import { DataPanelClientManager } from './manager';
import { DataPanelClient } from './client';
import { ControlPanel } from '../control_panel';
import { Logger } from '#self/lib/loggers';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';

export class DataPanelSubscription {
  static SubscriptionNames = [
    'requestQueueing',
    'workerTrafficStats',
    'containerStatusReport'
  ];

  panel: ControlPanel;
  logger: Logger;

  constructor(manager: DataPanelClientManager, private client: DataPanelClient) {
    this.client = client;
    this.panel = manager.panel;
    this.logger = loggers.get('data panel subscription');
  }

  async requestQueueing(requestQueueingRequest: NotNullableInterface<root.alice.data.IRequestQueueingBroadcast>) {
    const panel = this.panel;
    const { capacityManager } = panel;
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

  async workerTrafficStats(snapshot: root.alice.data.WorkerTrafficStatsSnapshot) {
    const { panel: { capacityManager } } = this;

    try {
      await capacityManager.syncWorkerData(snapshot.brokers);
      await capacityManager.autoScale();
    } catch (e) {
      this.logger.error('Failed to process capacityManager.syncWorkerData / capacityManager.autoScale', e);
    }
  }

  async containerStatusReport(report: NotNullableInterface<root.alice.data.IContainerStatusReport>) {
    const panel = this.panel;
    const { capacityManager } = panel;

    try {
      await capacityManager.updateWorkerContainerStatus(report);
    } catch (error) {
      this.logger.error(`Failed to process containerStatusReport [${JSON.stringify(report)}].`, error);
    }
  }

  /**
   * Subscribe Data Panel's broadcasting
   */
  subscribe() {
    for (const name of DataPanelSubscription.SubscriptionNames) {
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
