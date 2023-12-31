import * as MidwayLogger from '@midwayjs/logger';

const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevels = (typeof levels)[number];
// ILogger 未定义 close 方法
export type Sink = Pick<
  MidwayLogger.ILogger,
  'debug' | 'info' | 'warn' | 'error' | 'write'
> & { close?: () => void };

interface LoggerMeta {
  label: string;
}

const noopSink: Sink = (() => {
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
  const midwayLogger: MidwayLogger.ILogger = MidwayLogger.createLogger(
    filename,
    {
      level: config.logger.level,
      fileLogName: filename ?? 'noslated.log',
      dir: config.logger.dir,
      enableConsole: config.logger.enableConsole,
      // no need to pipe errors to a different file.
      enableError: false,
      // keep after rotater
      maxFiles: 3,
      transports: {
        file: {
          bufferWrite: true,
        },
      },
    }
  );
  return midwayLogger;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface Logger extends Sink {}
class Logger {
  category: string;
  sink!: Sink;
  meta: LoggerMeta;

  constructor(category: string, sink: Sink, level: LogLevels) {
    this.category = category;
    this.setSink(sink, level);
    this.meta = {
      label: this.category,
    };
  }

  setSink(sink: Sink, level: LogLevels = 'debug') {
    this.sink = sink;
    const expectedLevel = levels.indexOf(level);
    for (const [idx, lvl] of levels.entries()) {
      if (idx < expectedLevel) {
        this[lvl] = noopSink[lvl];
        continue;
      }
      this[lvl] = (...args) => {
        this.sink[lvl](...args, {
          label: this.meta.label,
        });
      };
    }
  }
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
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
  _sinkLevel: LogLevels = 'debug';

  constructor() {
    this.loggers = new Map();
    this.sink = noopSink;
  }

  setSink(sink: Sink, level?: LogLevels) {
    if (level == null) {
      const { config } = require('#self/config');
      level = config.logger.level.toLowerCase();
    }
    this.sink = sink;
    this._sinkLevel = level!;
    for (const logger of this.loggers.values()) {
      logger.setSink(this.sink, level);
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

    const logger = new Logger(category, this.sink, this._sinkLevel);
    this.loggers.set(category, logger);
    return logger;
  }

  close() {
    this.sink.close?.();
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
