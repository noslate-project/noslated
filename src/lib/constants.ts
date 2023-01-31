export enum ContainerStatus {
  Created = 1,
  Ready = 2,
  PendingStop = 3,
  Stopped = 4,
  Unknown = 5,
}

export enum ContainerStatusReport {
  ContainerInstalled = 'ContainerInstalled',
  RequestDrained = 'RequestDrained',
  ContainerDisconnected = 'ContainerDisconnected',
}

export enum ControlPanelEvent {
  Shrink = 'Shrink',
  Expand = 'Expand',
  RequestQueueExpand = 'RequestQueueExpand',
}

export enum TurfStatusEvent {
  StatusNull = 'StatusNull',
  StatusUnknown = 'StatusUnknown',
  StatusStopped = 'StatusStopped',
  ConnectTimeout = 'ConnectTimeout',
}

export const kDefaultRequestId = 'unknown';

export enum NoslatedResponseEvent {
  StreamEnd = 'noslate_response_stream_end',
}
