/**
 * TODO: Rename to WorkerStatus
 */
export enum ContainerStatus {
  Created = 1,
  Ready,
  PendingStop,
  Stopped,
  PendingGC,
  GarbageCollected,
  Unknown,
}

/**
 * TODO: Rename to WorkerStatusReport
 */
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
