import { ILogger, LoggerFactory, LoggerOptions } from '@midwayjs/logger';
import { config } from '#self/config';

const levels = ['debug', 'info', 'warn', 'error'] as const;
type LogLevels = (typeof levels)[number];

export const DefaultSink: Sink = (() => {
  const log = () => {};
  const logger: any = {
    [Symbol.toStringTag]: 'NoopLogger',
  };
  for (const lvl of levels) {
    logger[lvl] = log;
  }
  return logger;
})();

export interface ILoggerFactory<T extends LoggerOptions = LoggerOptions> {
  createLogger(filename: string, options: T): ILogger;
  close(): void;
  get(name: string): ILogger;
}

export interface Sink
  extends Pick<ILogger, 'debug' | 'info' | 'error' | 'warn' | 'write'> {
  debug(msg: any, ...args: any[]): void;
  info(msg: any, ...args: any[]): void;
  error(msg: any, ...args: any[]): void;
  warn(msg: any, ...args: any[]): void;
  write(msg: any, ...args: any[]): void;
}

// logger.info('foobar');
// output: [CATEGORY] foobar
export class Logger implements Omit<Sink, 'write'> {
  category: string;
  sink!: Sink;

  constructor(category: string, sink: Sink, level: LogLevels = 'debug') {
    this.category = category;
    this.setSink(sink, level);
  }

  setSink(sink: Sink, level: LogLevels = 'debug') {
    this.sink = sink;
    const expectedLevel = levels.indexOf(level);

    for (const [idx, lvl] of levels.entries()) {
      if (idx < expectedLevel) {
        this[lvl] = DefaultSink[lvl];
        continue;
      }
      // @see: https://github.com/midwayjs/logger/blob/main/src/logger.ts#L57
      this[lvl] = (msg: any, ...args: any[]) => {
        this.sink[lvl](`[${this.category}] ${msg}`, ...args);
      };
    }
  }

  debug(msg: any, ...args: any[]) {}

  info(msg: any, ...args: any[]) {}

  warn(msg: any, ...args: any[]) {}

  error(msg: any, ...args: any[]) {}
}

// logger.info('foobar');
// output: [CATEGORY] [prefix] foobar
export class PrefixedLogger implements Omit<Sink, 'write'> {
  logger: Logger;
  prefix: string;

  constructor(category: string, prefix: string) {
    this.logger = loggers.get(category);
    this.prefix = prefix;
  }

  debug(msg: any, ...args: any[]) {
    this.logger.debug(`[${this.prefix}] ${msg}`, ...args);
  }

  info(msg: any, ...args: any[]) {
    this.logger.info(`[${this.prefix}] ${msg}`, ...args);
  }

  warn(msg: any, ...args: any[]) {
    this.logger.warn(`[${this.prefix}] ${msg}`, ...args);
  }

  error(msg: any, ...args: any[]) {
    this.logger.error(`[${this.prefix}] ${msg}`, ...args);
  }
}

export function getDefaultSinkConfig(filename: string): LoggerOptions {
  const loggerConfig: LoggerOptions = {
    level: config.logger.level,

    transports: {
      file: {
        level: config.logger.level,
        dir: config.logger.dir,
        maxFiles: 3,
        fileLogName: filename ?? 'noslated.log',
        bufferWrite: true,
      },
    },
  };

  if (config.logger.enableConsole) {
    loggerConfig.transports!.console = {
      level: config.logger.level,
    };
  }

  return loggerConfig;
}

export class Loggers {
  static createLoggerFactory(): ILoggerFactory {
    let LoggerFactoryClz = LoggerFactory;

    if (config.logger.customFactoryPath) {
      const CustomLoggerFactory = require(config.logger.customFactoryPath);
      LoggerFactoryClz = CustomLoggerFactory;
    }

    return new LoggerFactoryClz();
  }

  static loggerFactory: ILoggerFactory;

  static getPrettySink(filename: string) {
    return this.loggerFactory.createLogger(
      filename,
      getDefaultSinkConfig(filename)
    );
  }

  private _loggers: Map<string, Logger>;
  private _sink: Sink;
  private _sinkLevel: LogLevels = 'debug';

  constructor() {
    this._loggers = new Map();
    this._sink = DefaultSink;
  }

  setSink(sink: Sink, level?: LogLevels) {
    const _level =
      level ?? (config.logger.level.toLocaleLowerCase() as LogLevels);

    this._sink = sink;
    this._sinkLevel = _level;

    for (const logger of this._loggers.values()) {
      logger.setSink(this._sink, _level);
    }
  }

  getSink() {
    return this._sink;
  }

  get(category: string): Logger {
    category = category.toUpperCase();

    if (this._loggers.has(category)) {
      return this._loggers.get(category)!;
    }

    const logger = new Logger(category, this._sink, this._sinkLevel);
    this._loggers.set(category, logger);

    return logger;
  }

  close() {
    Loggers.loggerFactory.close();
  }
}

// 初始化 noslate 内部的 loggerFactory，防止干扰
// 默认 midwayjs/logger 导出的是全局的
Loggers.loggerFactory = Loggers.createLoggerFactory();
export const loggers = new Loggers();
