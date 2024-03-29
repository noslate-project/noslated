import { Event } from '#self/lib/event-bus';
import { FunctionProfileManagerEvents } from '#self/lib/function_profile';
import { NotNullableInterface } from '#self/lib/interfaces';
import { RuntimeType } from '#self/lib/json/function_profile';
import { TurfState } from '#self/lib/turf/types';
import * as root from '#self/proto/root';
import { DataPlaneClient } from './data_plane_client/client';

export class ContainerReconciledEvent extends Event {
  static type = 'container-reconciled';
  constructor() {
    super(ContainerReconciledEvent.type);
  }
}

export class FunctionProfileSynchronizedEvent extends Event {
  static type = 'function-profile-synchronized';
  constructor() {
    super(FunctionProfileSynchronizedEvent.type);
  }
}

export class PlatformEnvironsUpdatedEvent extends Event {
  static type = 'platform-environs-updated';
  constructor(public data: Record<string, string>) {
    super(PlatformEnvironsUpdatedEvent.type);
  }
}

export class RequestQueueingEvent extends Event {
  static type = 'request-queueing';
  constructor(
    public data: NotNullableInterface<root.noslated.data.IRequestQueueingBroadcast>,
    public client: DataPlaneClient
  ) {
    super(RequestQueueingEvent.type);
  }
}

export class WorkerStatusReportEvent extends Event {
  static type = 'worker-status-report';
  constructor(
    public data: NotNullableInterface<root.noslated.data.IContainerStatusReport>
  ) {
    super(WorkerStatusReportEvent.type);
  }
}

interface WorkerStoppedData {
  state: TurfState | null;
  runtimeType: RuntimeType;
  functionName: string;
  registerTime: number;
  workerName: string;
}
export class WorkerStoppedEvent extends Event {
  static type = 'worker-stopped';
  constructor(public data: WorkerStoppedData) {
    super(WorkerStoppedEvent.type);
  }
}

export class WorkerTrafficStatsEvent extends Event {
  static type = 'worker-traffic-stats';
  constructor(
    public data: NotNullableInterface<root.noslated.data.IBrokerStats[]>
  ) {
    super(WorkerTrafficStatsEvent.type);
  }
}

export const events = [
  ContainerReconciledEvent,
  ...FunctionProfileManagerEvents,
  FunctionProfileSynchronizedEvent,
  PlatformEnvironsUpdatedEvent,
  RequestQueueingEvent,
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
  WorkerTrafficStatsEvent,
];
