import { Clock, systemClock, TimerHandle } from './clock';
import { createDeferred, Deferred } from './util';
import { AbortError } from './errors/abort_error';
import { List } from './list';

export interface QueueOptions {
  /**
   * @default systemClock
   */
  clock?: Clock;
  /**
   * @default 1
   */
  concurrency?: number;
  delay?: number;
  highWaterMark?: number;
}

export interface TaskOptions {
  abortSignal?: AbortSignal;
}

interface TaskItem<T> {
  deadline: number;
  abortSignal?: AbortSignal;
  deferred: Deferred<void>;
  value: T;
}

export class Queue<T> {
  private readonly _concurrency: number;
  private readonly _processor: Processor<T>;
  private readonly _delay: number;
  private readonly _highWaterMark: number;

  private _queue: List<TaskItem<T>>;
  private _runningCount = 0;

  private _clock: Clock;
  private _timerHandle: TimerHandle | null = null;

  private _closed = false;

  #process = () => {
    const now = this._clock.now();
    while (this._queue.length !== 0) {
      if (this._runningCount >= this._concurrency) {
        // break current session of drain.
        break;
      }

      const task = this._queue.at(0)!;
      if (task.abortSignal?.aborted) {
        // if it's already aborted, skip and drain queue.
        this._queue.shift();
        continue;
      }

      const delay = task.deadline === Infinity ? 0 : task.deadline - now;
      if (this._queue.length <= this._highWaterMark && delay > 0) {
        this._clock.clearTimeout(this._timerHandle);
        this._timerHandle = this._clock.setTimeout(this.#process, delay);
        break;
      }
      this._clock.clearTimeout(this._timerHandle);

      // remove from queue.
      this._queue.shift();

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

  constructor(processor: Processor<T>, options?: QueueOptions) {
    this._clock = options?.clock ?? systemClock;
    this._concurrency = options?.concurrency ?? 1;
    this._delay = options?.delay ?? 0;
    this._highWaterMark = options?.highWaterMark ?? Infinity;
    this._processor = processor;
    this._queue = new List();
  }

  enqueue(value: T, options?: TaskOptions) {
    if (this._closed) {
      throw new Error('TaskQueue has been closed');
    }
    const abortSignal = options?.abortSignal;

    const task: TaskItem<T> = {
      deadline: this._clock.now() + this._delay,
      abortSignal: abortSignal,
      deferred: createDeferred<void>(),
      value,
    };
    const node = this._queue.push(task);
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        this._queue.remove(node);
        task.deferred.reject(new AbortError(abortSignal.reason));
      });
    }

    queueMicrotask(() => {
      this.#process();
    });

    return task.deferred.promise;
  }

  clear() {
    this._queue = new List();
  }

  close() {
    this._closed = true;
    this._clock.clearTimeout(this._timerHandle);
    this._timerHandle = null;

    while (this._queue.length !== 0) {
      const item = this._queue.shift()!;
      item.deferred.reject(new AbortError('TaskQueue closed'));
    }
  }

  get closed() {
    return this._closed;
  }
}

export type Processor<T> = (task: T) => Promise<void>;
