import { DataPlaneClient } from './client';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';
import { EventBus } from '#self/lib/event-bus';
import {
  RequestQueueingEvent,
  WorkerStatusReportEvent,
  WorkerTrafficStatsEvent,
} from '../events';
import { Clock, TimerHandle } from '#self/lib/clock';
import { LoggerFactory, PrefixedLogger } from '#self/lib/logger_factory';

export class DataPlaneSubscription {
  static SubscriptionNames = ['requestQueueing', 'containerStatusReport'];

  private logger: PrefixedLogger;
  private closed = false;

  private trafficStatsTimeout: TimerHandle | null = null;

  constructor(
    private eventBus: EventBus,
    private client: DataPlaneClient,
    private pullingInterval: number,
    private _clock: Clock
  ) {
    this.client = client;
    this.logger = LoggerFactory.prefix('data plane subscription');
  }

  async requestQueueing(
    requestQueueingRequest: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>
  ) {
    this.logger.debug(
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

  async containerStatusReport(
    report: NotNullableInterface<root.noslated.data.IContainerStatusReport>
  ) {
    this.logger.debug(
      'receive container status report: functionName(%s), workerName(%s), isInspector(%s), event(%s)',
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

  async _pullWorkerTrafficStats() {
    const stats = (await (this.client as any).getWorkerTrafficStats(
      {}
    )) as root.noslated.data.IWorkerTrafficStatsResponse;
    this.logger.debug('pulled worker traffic stats');
    const event = new WorkerTrafficStatsEvent(stats?.brokers ?? []);
    await this.eventBus.publish(event);
  }

  _onWorkerTrafficStatsTimeout = () => {
    this._pullWorkerTrafficStats()
      .catch(e => {
        this.logger.error(
          'unexpected error on processing worker traffic stats',
          e
        );
      })
      .finally(() => {
        if (this.closed) {
          return;
        }
        this.trafficStatsTimeout = this._clock.setTimeout(
          this._onWorkerTrafficStatsTimeout,
          this.pullingInterval
        );
      });
  };

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
    this.trafficStatsTimeout = this._clock.setTimeout(
      this._onWorkerTrafficStatsTimeout,
      this.pullingInterval
    );
  }

  unsubscribe() {
    this.closed = true;
    if (this.trafficStatsTimeout) {
      this._clock.clearTimeout(this.trafficStatsTimeout);
    }
  }
}
