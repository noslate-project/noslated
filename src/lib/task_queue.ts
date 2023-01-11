import { ICompare, PriorityQueue } from '@datastructures-js/priority-queue';
import { Clock, systemClock, TimerHandle } from './clock';
import { createDeferred, Deferred } from './util';
import { inspect, InspectOptions } from 'util';
import { AbortError } from './errors/abort_error';

export interface TaskQueueOptions<T> {
  /**
   * @default systemClock
   */
  clock?: Clock;
  /**
   * @default 1
   */
  concurrency?: number;
  compare?: ICompare<T>;
}

export interface TaskOptions {
  delay?: number;
  priority?: Priority;
  abortSignal?: AbortSignal;
}
interface TaskItem<T> {
  deadline: number;
  priority: Priority;
  abortSignal?: AbortSignal;
  deferred: Deferred<void>;
  value: T;
}

export class TaskQueue<T> {
  private readonly _concurrency: number;
  private readonly _compare?: ICompare<T>;
  private readonly _processor: Processor<T>;

  private _queue: PriorityQueue<TaskItem<T>>;
  private _runningCount = 0;

  private _clock: Clock;
  private _timerHandle: TimerHandle | null = null;

  private _closed = false;

  #process = () => {
    const now = this._clock.now();
    while (!this._queue.isEmpty()) {
      if (this._runningCount >= this._concurrency) {
        // break current session of drain.
        break;
      }

      const task = this._queue.front();
      if (task.abortSignal?.aborted) {
        // if it's already aborted, skip and drain queue.
        this._queue.dequeue();
        continue;
      }

      const delay = task.deadline === Infinity ? 0 : task.deadline - now;
      if (delay > 0) {
        this._clock.clearTimeout(this._timerHandle);
        this._timerHandle = this._clock.setTimeout(this.#process, delay);
        break;
      }

      // remove from queue.
      this._queue.dequeue();

      this._runningCount++;
      this._processor(task.value).then(
        () => {
          task.deferred.resolve();
          this._runningCount--;
          // drain queue;
          this.#process();
        },
        err => {
          task.deferred.reject(err);
          this._runningCount--;
          // drain queue;
          this.#process();
        }
      );

      // drain to fulfill concurrency.
    }
  };

  #taskCompare: ICompare<TaskItem<T>> = (lhs, rhs) => {
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

    return 0;
  };

  constructor(processor: Processor<T>, options?: TaskQueueOptions<T>) {
    this._clock = options?.clock ?? systemClock;
    this._concurrency = options?.concurrency ?? 1;
    this._compare = options?.compare;
    this._processor = processor;
    this._queue = new PriorityQueue<TaskItem<T>>(this.#taskCompare);
  }

  enqueue(value: T, options?: TaskOptions) {
    if (this._closed) {
      throw new Error('TaskQueue has been closed');
    }
    const abortSignal = options?.abortSignal;
    let deadline = Infinity;
    if (options?.delay != null) {
      deadline = this._clock.now() + options.delay;
    }

    const task: TaskItem<T> = {
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
      this.#process();
    });

    return task.deferred.promise;
  }

  clear() {
    this._queue.clear();
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
}

export enum Priority {
  kHigh = 3,
  kNormal = 2,
  kLow = 1,
}

export type Processor<T> = (task: T) => Promise<void>;
