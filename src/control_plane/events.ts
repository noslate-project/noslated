import { Event } from '#self/lib/event-bus';
import { FunctionProfileUpdateEvent } from '#self/lib/function_profile';
import { NotNullableInterface } from '#self/lib/interfaces';
import { TurfState } from '#self/lib/turf/types';
import * as root from '#self/proto/root';
import { DataPlaneClient } from './data_plane_client/client';
import { Broker } from './worker_stats';

export class FunctionRemovedEvent extends Event {
  static type = 'function-removed';
  constructor(public data: string[]) {
    super(FunctionRemovedEvent.type);
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
  emitExceptionMessage: string | undefined;
  state: TurfState | null;
  broker: Broker;
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
    public data: NotNullableInterface<root.noslated.data.IWorkerTrafficStatsSnapshot>
  ) {
    super(WorkerTrafficStatsEvent.type);
  }
}

export const events = [
  FunctionRemovedEvent,
  FunctionProfileUpdateEvent,
  PlatformEnvironsUpdatedEvent,
  RequestQueueingEvent,
  WorkerStatusReportEvent,
  WorkerStoppedEvent,
  WorkerTrafficStatsEvent,
].map(it => it.type);
