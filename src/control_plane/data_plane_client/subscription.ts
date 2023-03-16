import loggers from '#self/lib/logger';
import { DataPlaneClient } from './client';
import { Logger } from '#self/lib/loggers';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';
import { EventBus } from '#self/lib/event-bus';
import {
  RequestQueueingEvent,
  WorkerStatusReportEvent,
  WorkerTrafficStatsEvent,
} from '../events';

export class DataPlaneSubscription {
  static SubscriptionNames = [
    'requestQueueing',
    'workerTrafficStats',
    'containerStatusReport',
  ];

  logger: Logger;

  constructor(private eventBus: EventBus, private client: DataPlaneClient) {
    this.client = client;
    this.logger = loggers.get('data plane subscription');
  }

  async requestQueueing(
    requestQueueingRequest: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>
  ) {
    this.logger.info(
      'received request queueing event (requestId: %s) for func(%s, inspect %s) with request count %d gap(%d)',
      requestQueueingRequest.requestId,
      requestQueueingRequest.name,
      requestQueueingRequest.isInspect,
      requestQueueingRequest.queuedRequestCount,
      Date.now() - requestQueueingRequest.timestamp
    );

    const event = new RequestQueueingEvent(requestQueueingRequest, this.client);
    try {
      await this.eventBus.publish(event);
    } catch (e) {
      this.logger.error(
        `Failed to deal with queueing request. name: ${requestQueueingRequest.name}, requestId: ${requestQueueingRequest.requestId}`,
        e
      );
    }
  }

  async workerTrafficStats(
    snapshot: root.noslated.data.WorkerTrafficStatsSnapshot
  ) {
    const event = new WorkerTrafficStatsEvent(snapshot);
    try {
      await this.eventBus.publish(event);
    } catch (e) {
      this.logger.error('Failed to process WorkerTrafficStats event', e);
    }
  }

  async containerStatusReport(
    report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
  ) {
    this.logger.info(
      'receive container status report: requestId(%s), functionName(%s), workerName(%s), isInspector(%s), event(%s)',
      report.requestId,
      report.functionName,
      report.name,
      report.isInspector,
      report.event
    );

    const event = new WorkerStatusReportEvent(report);
    try {
      await this.eventBus.publish(event);
    } catch (e) {
      this.logger.error('Failed to process containerStatusReport', e);
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
          process.nextTick(() => {
            throw e;
          });
        }
      });
    }
  }
}
