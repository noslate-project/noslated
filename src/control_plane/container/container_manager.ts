import path from 'path';
import { TurfContainerStates, TurfSpec, TurfState } from '#self/lib/turf/types';

export interface ContainerStartOptions {
  seed?: string;
}

export interface ContainerManager {
  ready(): Promise<void>;
  close(): Promise<void>;

  spawn(
    name: string,
    bundlePath: string,
    spec: TurfSpec,
    options?: ContainerStartOptions
  ): Promise<Container>;
  getContainer(name: string): Container | null;
  list(): Container[];
  reconcileContainers(): Promise<void>;
}

export interface Container {
  stop(): Promise<void>;
  state(): Promise<TurfState>;

  onstatuschanged: () => void;

  readonly pid?: number;
  readonly name: string;
  readonly status: TurfContainerStates;
  readonly terminated: Promise<TurfState | null>;
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
