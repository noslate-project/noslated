import { Clock, systemClock, TimerHandle } from './clock';
import { createDeferred, Deferred } from './util';
import { AbortError } from './errors/abort_error';
import { List } from './list';

export interface TaskQueueOptions {
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

export interface TaskItem<T> {
  deadline: number;
  abortSignal?: AbortSignal;
  deferred: Deferred<void>;
  value: T;
}

export class TaskQueue<T> implements Queue<T> {
  readonly _concurrency: number;
  readonly _processor: Processor<T>;
  readonly _highWaterMark: number;
  readonly _clock: Clock;
  _runningCount = 0;
  _timerHandle: TimerHandle | null = null;

  private readonly _delay: number;
  private _queue: List<TaskItem<T>>;
  private _closed = false;

  constructor(processor: Processor<T>, options?: TaskQueueOptions) {
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
      processQueue(this);
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

  _queueLength(): number {
    return this._queue.length;
  }

  _queuePeek(): TaskItem<T> {
    return this._queue.at(0)!;
  }

  _dequeue(): TaskItem<T> {
    return this._queue.shift()!;
  }
}

export type Processor<T> = (task: T) => Promise<void>;

export interface Queue<T> {
  readonly _clock: Clock;
  readonly _highWaterMark: number;
  readonly _concurrency: number;
  readonly _processor: Processor<T>;
  _timerHandle: TimerHandle | null;
  _runningCount: number;

  _queueLength(): number;
  _queuePeek(): TaskItem<T>;
  _dequeue(): TaskItem<T>;
}

export function processQueue<T>(queue: Queue<T>) {
  const now = queue._clock.now();
  while (queue._queueLength() !== 0) {
    if (queue._runningCount >= queue._concurrency) {
      // break current session of drain.
      break;
    }

    const task = queue._queuePeek()!;
    if (task.abortSignal?.aborted) {
      // if it's already aborted, skip and drain queue.
      queue._dequeue();
      continue;
    }

    const delay = task.deadline === Infinity ? 0 : task.deadline - now;
    if (queue._queueLength() <= queue._highWaterMark && delay > 0) {
      queue._clock.clearTimeout(queue._timerHandle);
      queue._timerHandle = queue._clock.setTimeout(
        () => processQueue(queue),
        delay
      );
      break;
    }
    queue._clock.clearTimeout(queue._timerHandle);

    // remove from queue.
    queue._dequeue();

    queue._runningCount++;
    queue._processor(task.value).then(
      () => {
        task.deferred.resolve();
        queue._runningCount--;
        // drain queue;
        processQueue(queue);
      },
      err => {
        task.deferred.reject(err);
        queue._runningCount--;
        // drain queue;
        processQueue(queue);
      }
    );

    // drain to fulfill concurrency.
  }
}
