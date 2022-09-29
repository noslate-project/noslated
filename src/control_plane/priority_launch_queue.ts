import { ICompare, PriorityQueue } from '@datastructures-js/priority-queue';
import { BaseOptions } from './starter/base';

/**
 * TODO: PriorityQueue 基于 Heap 实现
 * 多优先级穿插插入时，同优先级排序上有一点问题，需要进一步修复
 */
export class PriorityLaunchQueue {
  readonly #concurrency: number;
  readonly #interval: number;

  #queue: PriorityQueue<LaunchTask>;
  #runningCount: number;
  #intervalId: NodeJS.Timer | undefined;

  process = async () => {
    if (this.#queue.size() === 0) return;

    const preview: LaunchTask = this.#queue.front();

    if (!preview.disposable) {
      if (this.#runningCount >= this.#concurrency) return;

      this.#runningCount++;
    }

    const task: LaunchTask = this.#queue.dequeue();

    await task.processer(task, this);

    if (!preview.disposable) {
      this.#runningCount --;
    }
  }

  constructor(concurrency: number, interval: number = 0) {
    this.#concurrency = concurrency;
    this.#runningCount = 0;
    this.#queue = new PriorityQueue<LaunchTask>(compare);
    this.#intervalId = undefined;
    this.#interval = interval;
  }

  enqueue(task: LaunchTask) {
    this.#queue.enqueue(task);
  }

  dequeue(): LaunchTask {
    return this.#queue.dequeue();
  }

  start() {
    if (!this.#intervalId) {
      this.#intervalId = setInterval(this.process, this.#interval);
    }
  }

  stop() {
    if (this.#intervalId) {
      clearInterval(this.#intervalId);
      this.#intervalId = undefined;
    }
  }
}

const compare: ICompare<LaunchTask> = (a: LaunchTask, b: LaunchTask) => {
  if (a.priority > b.priority) {
    return 1;
  }

  if (a.priority < b.priority) {
    return -1;
  }

  if (a.timestamp < b.timestamp) {
    return -1;
  }

  return 1;
};

export interface LaunchTask {
  timestamp: number;
  priority: number;
  functionName: string;
  disposable: boolean;
  options: BaseOptions;
  processer: TaskProcessor;
  requestId?: string;
}

export enum TaskPriority {
  HIGH = 1,
  NORMAL = 2,
  LOW = 3,
}

export type TaskProcessor = (task: LaunchTask, queue: PriorityLaunchQueue) => Promise<void>;