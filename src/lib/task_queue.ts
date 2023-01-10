// Migrate from https://github.com/XadillaX/scarlet-task
import EventEmitter from 'events';

export class TaskQueueItem<T> {
  constructor(
    public parent: TaskQueue<T>,
    public queueId: number,
    public task: T
  ) {}

  /**
   * Done the task item.
   */
  done() {
    this.parent.taskDone(this);
  }
}

export class TaskQueue<T> extends EventEmitter {
  queue: TaskData<T>[][];
  running: boolean[];

  constructor(private queueCount = 1) {
    super();
    this.queue = [];
    this.running = [];

    this.on('done', queueId => {
      process.nextTick(() => {
        this._runTask(queueId);
      });
    });

    for (let i = 0; i < this.queueCount; i++) {
      this.queue.push([]);
      this.running.push(false);
    }
  }

  /**
   * Push a task to the queue.
   * @param {any} task The task data.
   * @param {(taskObject: TaskQueueItem) => void} processor The process function.
   */
  push(task: T, processor: TaskProcessor<T>) {
    let min = 0;
    for (let i = 1; i < this.queueCount; i++) {
      if (this.queue[i].length < this.queue[min].length) {
        min = i;
      }
    }

    this.queue[min].push({
      queueId: min,
      task,
      processor,
    });

    if (!this.running[min]) {
      this.running[min] = true;
      process.nextTick(() => {
        this._runTask(min);
      });
    }
  }

  taskDone(item: TaskQueueItem<T>) {
    process.nextTick(() => {
      this.emit('done', item.queueId);
    });
  }

  _runTask(queueId: number) {
    if (!this.queue[queueId].length) {
      this.running[queueId] = false;
      return;
    }

    this.running[queueId] = true;

    const taskItem = this.queue[queueId].shift();

    if (!taskItem) {
      return;
    }

    const { task, processor } = taskItem;
    const item = new TaskQueueItem(this, queueId, task);

    processor(item);
  }
}

interface TaskData<T> {
  queueId: number;
  task: T;
  processor: TaskProcessor<T>;
}

type TaskProcessor<T> = (taskObject: TaskQueueItem<T>) => void;
