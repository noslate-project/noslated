import { promises as fs } from 'fs';
import { Config } from '#self/config';
import { Clock } from '#self/lib/clock';
import { Base } from '#self/lib/sdk_base';
import { workerLogPath } from './container/container_manager';
import { WorkerStoppedEvent } from './events';
import { EventBus } from '#self/lib/event-bus';
import { DependencyContext } from '#self/lib/dependency_context';
import { TaskQueue } from '#self/lib/task_queue';
import { LoggerFactory, PrefixedLogger } from '#self/lib/logger_factory';

export type ResourceManagerContext = {
  config: Config;
  clock: Clock;
  eventBus: EventBus;
};

// TODO: Per-function resources.
export class ResourceManager extends Base {
  private config: Config;
  private clock: Clock;
  private logger: PrefixedLogger;
  private gcQueue: TaskQueue<string>;

  constructor(ctx: DependencyContext<ResourceManagerContext>) {
    super();
    this.config = ctx.getInstance('config');
    this.clock = ctx.getInstance('clock');

    this.logger = LoggerFactory.prefix('resource manager');
    this.gcQueue = new TaskQueue(this.#gcLog, {
      clock: this.clock,
      delay: this.config.worker.gcLogDelay,
      highWaterMark: this.config.worker.gcLogHighWaterMark,
    });

    const eventBus = ctx.getInstance('eventBus');
    eventBus.subscribe(WorkerStoppedEvent, {
      next: this.#onWorkerStopped,
    });
  }

  async _init() {
    // ignore
  }

  async _close() {
    /** ignore unfinished tasks */
    this.gcQueue.clear();
    this.gcQueue.close();
  }

  #onWorkerStopped = (event: WorkerStoppedEvent) => {
    // 清理 log 文件
    this.gcQueue.enqueue(event.data.workerName);
  };

  #gcLog = async (workerName: string) => {
    const logDir = workerLogPath(this.config.logger.dir, workerName);
    try {
      await fs.rm(logDir, { recursive: true });
      this.logger.debug('[%s] log directory removed: %s.', workerName, logDir);
    } catch (e) {
      this.logger.warn(
        'Failed to rm [%s] log directory: %s.',
        workerName,
        logDir,
        e
      );
    }
  };

  async makeWorkerDirs(workerName: string, dirs: string[]) {
    const logDir = workerLogPath(this.config.logger.dir, workerName);

    this.logger.debug('create directories for worker(%s)', workerName);
    await Promise.all(
      [logDir, ...(dirs ?? [])].map(dir => fs.mkdir(dir, { recursive: true }))
    );
  }
}
