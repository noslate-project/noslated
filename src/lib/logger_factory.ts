import {
  LoggerFactory as MidwayLoggerFactory,
  loggers,
  ILogger,
  MidwayLogger,
} from '@midwayjs/logger';
import { config } from '#self/config';

const noop = () => {};

export class LoggerFactory {
  private static _defaultSink: ILogger = {
    [Symbol.toStringTag]: 'NoopLogger',
    warn: noop,
    info: noop,
    debug: noop,
    error: noop,
  } as unknown as ILogger;

  private static _prefixdLoggers: Map<string, PrefixedLogger> = new Map();

  static getLoggerConfig(filename: string) {
    return {
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
    };
  }

  static init(filename: string, sink?: ILogger) {
    if (sink) {
      this._defaultSink = sink;
    } else {
      this._defaultSink = loggers.createLogger(
        filename,
        this.getLoggerConfig(filename)
      ) as MidwayLogger;
    }
  }

  static create(filename: string): ILogger {
    return loggers.createLogger(filename, this.getLoggerConfig(filename));
  }

  static prefix(prefix: string): PrefixedLogger {
    let prefixedLogger = this._prefixdLoggers.get(prefix);

    if (!prefixedLogger) {
      const prefixUpper = prefix.toUpperCase();

      prefixedLogger = new Proxy(this._defaultSink, {
        get(target, prop) {
          if (
            prop === 'debug' ||
            prop === 'info' ||
            prop === 'warn' ||
            prop === 'error'
          ) {
            // @see: https://github.com/midwayjs/logger/blob/main/src/interface.ts#L6
            return (...args: [any, any[]]) => {
              target[prop](`[${prefixUpper}] ${args.join(' ')}`);
            };
          } else {
            return noop();
          }
        },
      });

      this._prefixdLoggers.set(prefix, prefixedLogger);
    }

    return prefixedLogger;
  }

  static close() {
    this._prefixdLoggers.clear();
    loggers.close();
  }
}

export type PrefixedLogger = Pick<ILogger, 'debug' | 'info' | 'warn' | 'error'>;
