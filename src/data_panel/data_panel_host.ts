import { DataPanelImpl } from './impl/data_panel';
import { descriptor } from '#self/lib/rpc/util';
import { Host } from '#self/lib/rpc/host';
import { PushServerImpl } from './impl/push_server';
import { Config } from '#self/config';
import { DataFlowController } from './data_flow_controller';
import { WorkerBroker } from './worker_broker';
import * as root from '#self/proto/root';

const logger = require('#self/lib/logger').get('data panel host');

export class DataPanelHost extends Host {
  dataFlowController: DataFlowController | null;

  constructor(address: string, public config: Config) {
    super(address, logger);
    this.dataFlowController = null;
  }

  async start(dataFlowController: DataFlowController) {
    this.dataFlowController = dataFlowController;
    this.addService((descriptor as any).alice.data.DataPanel.service, new DataPanelImpl(dataFlowController, this.config) as any);
    this.addService((descriptor as any).alice.data.PushServer.service, new PushServerImpl(dataFlowController, this.config) as any);
    return super.start();
  }

  /**
   *
   * @param {import('./worker_broker').WorkerBroker} workerBroker -
   * @param {*} brokerStats -
   */
  async broadcastRequestQueueing(workerBroker: WorkerBroker, brokerStats: root.alice.data.IBrokerStats, requestId: string) {
    return this.broadcast('requestQueueing', 'alice.data.RequestQueueingBroadcast', {
      name: workerBroker.name,
      isInspect: !!workerBroker.options.inspect,
      stats: {
        brokers: brokerStats,
      },
      queuedRequestCount: workerBroker.requestQueue.length,
      requestId
    });
  }

  async broadcastWorkerTrafficStats(brokerStats: root.alice.data.IBrokerStats) {
    await this.broadcast(
      'workerTrafficStats',
      'alice.data.WorkerTrafficStatsSnapshotBroadcast', brokerStats);
  }

  async broadcastContainerStatusReport(report: root.alice.data.IContainerStatusReport) {
    await this.broadcast(
      'containerStatusReport',
      'alice.data.ContainerStatusReport', report
    );
  }
}
