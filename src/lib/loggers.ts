import * as MidwayLogger from '@midwayjs/logger';
import { IMidwayLogger } from '@midwayjs/logger';

const levels = [ 'debug', 'info', 'warn', 'error' ] as const;
type LogLevels = (typeof levels)[number];
export type Sink = {
  [key in LogLevels]: (...args: unknown[]) => void;
}

interface LoggerMeta {
  label: string;
}

const noopSink = (() => {
  const log = () => {};
  const logger: any = {
    [Symbol.toStringTag]: 'NoopLogger',
  };
  for (const lvl of levels) {
    logger[lvl] = log;
  }
  return logger;
})();

function getPrettySink(filename: string) {
  const { config } = require('#self/config');
  const midwayLogger: IMidwayLogger = MidwayLogger.createLogger(filename, {
    level: config.logger.level,
    fileLogName: filename ?? 'alice.log',
    dir: config.logger.dir,
    // no need to pipe errors to a different file.
    disableError: true,
    // keep after rotater
    maxFiles: 3
  });
  return midwayLogger;
}

interface Logger extends Sink {}
class Logger {
  category: string;
  sink!: Sink;
  meta: LoggerMeta;

  constructor(category: string, sink: Sink) {
    this.category = category;
    this.setSink(sink);
    this.meta = {
      label: this.category,
    };
  }

  setSink(sink: Sink) {
    this.sink = sink;
    for (const lvl of levels) {
      this[lvl] = (...args) => {
        this.sink[lvl](...args, {
          label: this.meta.label,
        });
      };
    }
  }
}

interface PrefixedLogger extends Sink {}
class PrefixedLogger {
  logger: Logger;
  prefix: string;

  constructor(category: string, prefix: string) {
    this.logger = loggers.get(category);
    this.prefix = prefix;

    for (const lvl of levels) {
      this[lvl] = this.#write.bind(this, lvl);
    }
  }

  #write(level: LogLevels, msg: unknown, ...args: unknown[]) {
    this.logger[level](`[${this.prefix}] ${msg}`, ...args);
  }
}

class Loggers {
  /** TODO: use module named export */
  Logger = Logger;
  Loggers = Loggers;
  PrefixedLogger = PrefixedLogger;
  levels = levels;
  noopSink = noopSink;
  getPrettySink = getPrettySink;
  /** end */

  loggers: Map<string, Logger>;
  sink: Sink;

  constructor() {
    this.loggers = new Map();
    this.sink = noopSink;
  }

  setSink(sink: Sink) {
    this.sink = sink;
    for (const logger of this.loggers.values()) {
      logger.setSink(this.sink);
    }
  }

  getSink() {
    return this.sink;
  }

  /**
   * Get logger
   * @param category The logger category.
   * @return The logger object.
   */
  get(category: string): Logger {
    category = category.toUpperCase();

    if (this.loggers.has(category)) {
      return this.loggers.get(category)!;
    }

    const logger = new Logger(category, this.sink);
    this.loggers.set(category, logger);
    return logger;
  }
}

const loggers = new Loggers();

export {
  Logger,
  Loggers,
  PrefixedLogger,
  loggers,
  levels,
  LogLevels,
  noopSink,
  getPrettySink,
};
