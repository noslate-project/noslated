import { ICompare, PriorityQueue } from '@datastructures-js/priority-queue';
import { Clock, systemClock, TimerHandle } from './clock';
import { createDeferred } from './util';
import { inspect, InspectOptions } from 'util';
import { AbortError } from './errors/abort_error';
import { Queue, processQueue, Processor, TaskItem } from './task_queue';

export interface PriorityTaskQueueOptions<T> {
  /**
   * @default systemClock
   */
  clock?: Clock;
  /**
   * @default 1
   */
  concurrency?: number;
  highWaterMark?: number;
  compare?: ICompare<T>;
}

export interface PriorityTaskOptions {
  delay?: number;
  priority?: Priority;
  abortSignal?: AbortSignal;
}

interface PriorityTaskItem<T> extends TaskItem<T> {
  priority: Priority;
}

export class PriorityTaskQueue<T> implements Queue<T> {
  readonly _concurrency: number;
  readonly _highWaterMark: number;
  readonly _processor: Processor<T>;
  readonly _clock: Clock;
  _runningCount = 0;
  _timerHandle: TimerHandle | null = null;

  private readonly _compare?: ICompare<T>;
  private _queue: PriorityQueue<PriorityTaskItem<T>>;
  private _closed = false;

  #taskCompare: ICompare<PriorityTaskItem<T>> = (lhs, rhs) => {
    // prioritize expiring items
    if (lhs.deadline < rhs.deadline) {
      return -1;
    }
    // prioritize high priority items
    if (lhs.priority > rhs.priority) {
      return -1;
    }

    if (this._compare) {
      return this._compare(lhs.value, rhs.value);
    }

    if (lhs.deadline > rhs.deadline) {
      return 1;
    }
    if (lhs.priority < rhs.priority) {
      return 1;
    }

    return 0;
  };

  constructor(processor: Processor<T>, options?: PriorityTaskQueueOptions<T>) {
    this._clock = options?.clock ?? systemClock;
    this._concurrency = options?.concurrency ?? 1;
    this._highWaterMark = options?.highWaterMark ?? Infinity;
    this._compare = options?.compare;
    this._processor = processor;
    this._queue = new PriorityQueue(this.#taskCompare);
  }

  enqueue(value: T, options?: PriorityTaskOptions) {
    if (this._closed) {
      throw new Error('TaskQueue has been closed');
    }
    const abortSignal = options?.abortSignal;
    let deadline = Infinity;
    if (options?.delay != null) {
      deadline = this._clock.now() + options.delay;
    }

    const task: PriorityTaskItem<T> = {
      deadline,
      priority: options?.priority ?? Priority.kNormal,
      abortSignal: abortSignal,
      deferred: createDeferred<void>(),
      value,
    };
    this._queue.enqueue(task);
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        task.deferred.reject(new AbortError(abortSignal.reason));
      });
    }

    queueMicrotask(() => {
      processQueue(this);
    });

    return task.deferred.promise;
  }

  clear() {
    const queue = this._queue.toArray();
    this._queue = new PriorityQueue(this.#taskCompare);
    queue.forEach(it => {
      it.deferred.reject(new AbortError('Queue is cleared'));
    });
  }

  close() {
    this._closed = true;
    this._clock.clearTimeout(this._timerHandle);
    this._timerHandle = null;

    while (!this._queue.isEmpty()) {
      const item = this._queue.dequeue();
      item.deferred.reject(new AbortError('TaskQueue closed'));
    }
  }

  get closed() {
    return this._closed;
  }

  [inspect.custom](depth: number, options: InspectOptions) {
    return inspect(
      {
        closed: this._closed,
        concurrency: this._concurrency,
        queue: this._queue.toArray(),
      },
      options
    );
  }

  _queueLength(): number {
    return this._queue.size();
  }

  _queuePeek() {
    return this._queue.front();
  }

  _dequeue() {
    return this._queue.dequeue();
  }
}

export enum Priority {
  kHigh = 3,
  kNormal = 2,
  kLow = 1,
}
