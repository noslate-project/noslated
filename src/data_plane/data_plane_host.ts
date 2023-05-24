import { DataPlaneImpl } from './impl/data_plane';
import { descriptor } from '#self/lib/rpc/util';
import { Host } from '#self/lib/rpc/host';
import { PushServerImpl } from './impl/push_server';
import { Config } from '#self/config';
import { DataFlowController } from './data_flow_controller';
import { WorkerBroker } from './worker_broker';
import * as root from '#self/proto/root';

const logger = require('#self/lib/logger').get('data plane host');

export class DataPlaneHost extends Host {
  dataFlowController: DataFlowController | null;

  constructor(address: string, public config: Config) {
    super(address, logger);
    this.dataFlowController = null;
  }

  async start(dataFlowController: DataFlowController) {
    this.dataFlowController = dataFlowController;
    this.addService(
      (descriptor as any).noslated.data.DataPlane.service,
      new DataPlaneImpl(dataFlowController, this.config) as any
    );
    this.addService(
      (descriptor as any).noslated.data.PushServer.service,
      new PushServerImpl(dataFlowController, this.config) as any
    );
    return super.start();
  }

  broadcastRequestQueueing(workerBroker: WorkerBroker, requestId: string) {
    this.broadcast(
      'requestQueueing',
      'noslated.data.RequestQueueingBroadcast',
      {
        name: workerBroker.name,
        isInspect: !!workerBroker.options.inspect,
        queuedRequestCount: workerBroker.requestQueue.length,
        requestId,
        timestamp: Date.now(),
      }
    );
  }

  broadcastContainerStatusReport(
    report: root.noslated.data.IContainerStatusReport
  ) {
    this.broadcast(
      'containerStatusReport',
      'noslated.data.ContainerStatusReport',
      report
    );
  }
}
