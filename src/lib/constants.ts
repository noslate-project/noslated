export enum WorkerStatus {
  Created = 1,
  Ready,
  PendingStop,
  Stopped,
  GarbageCollected,
  Unknown,
}

export enum WorkerStatusReport {
  ContainerInstalled = 'ContainerInstalled',
  RequestDrained = 'RequestDrained',
  ContainerDisconnected = 'ContainerDisconnected',
}

export enum ControlPlaneEvent {
  Shrink = 'Shrink',
  Expand = 'Expand',
  RequestQueueExpand = 'RequestQueueExpand',
  FailedToSpawn = 'FailedToSpawn',
  InitializationTimeout = 'InitializationTimeout',
}

export enum TurfStatusEvent {
  StatusNull = 'StatusNull',
  StatusUnknown = 'StatusUnknown',
  StatusStopped = 'StatusStopped',
}

export const kDefaultRequestId = 'unknown';
