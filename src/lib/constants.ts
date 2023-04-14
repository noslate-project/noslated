export enum WorkerStatus {
  /**
   * Worker is created, initialization is not done.
   */
  Created,
  /**
   * Worker is actively processing requests.
   */
  Ready,
  /**
   * Worker is pending stop. It can no longer processing requests.
   */
  PendingStop,
  /**
   * Worker is stopped. It is pending garbage collection.
   */
  Stopped,
  /**
   * Status is not available. It is pending garbage collection.
   */
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
  FunctionRemoved = 'FunctionRemoved',
  RequestQueueExpand = 'RequestQueueExpand',
  Terminated = 'Terminated',
  FailedToSpawn = 'FailedToSpawn',
  InitializationTimeout = 'InitializationTimeout',
}

export enum TurfStatusEvent {
  StatusUnknown = 'StatusUnknown',
  StatusStopped = 'StatusStopped',
}

export const kDefaultRequestId = 'unknown';
export const kDefaultWorkerName = 'unknown';
export const kDefaultQueueingTime = -1;
