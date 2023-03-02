import path from 'path';
import { TurfContainerStates, TurfSpec, TurfState } from '#self/lib/turf/types';

export interface ContainerStartOptions {
  seed?: string;
}

export interface ContainerManager {
  ready(): Promise<void>;
  close(): Promise<void>;

  create(name: string, bundlePath: string, spec: TurfSpec): Promise<Container>;
  getContainer(name: string): Container | null;
  list(): Container[];
  reconcileContainers(): Promise<void>;
}

export interface Container {
  start(options?: ContainerStartOptions): Promise<void>;
  stop(): Promise<void>;
  state(): Promise<TurfState>;
  /**
   * @deprecated remove delete. The container should be deleted once the status is stopped.
   */
  delete(): Promise<void>;
  /**
   * @deprecated remove destroy. The container should be deleted once the status is stopped.
   */
  destroy(): Promise<void>;

  onstatuschanged?: () => void;

  readonly pid?: number;
  readonly name: string;
  readonly status: TurfContainerStates;
  readonly terminated: Promise<void>;
}

/**
 * Get worker's full log path.
 * @param {string} baseDir The log base directory.
 * @param {string} workerName The worker's name.
 * @param {string} filename The log filename.
 * @return {string} The full log path.
 */
export function workerLogPath(
  baseDir: string,
  workerName: string,
  ...args: string[]
) {
  return path.join(baseDir, 'workers', workerName, ...args);
}
