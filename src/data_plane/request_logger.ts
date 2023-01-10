import { Metadata } from '#self/delegate/request_response';
import loggers from '#self/lib/logger';
import { IMidwayLogger } from '@midwayjs/logger';

export class RequestLogger {
  accessLogger: IMidwayLogger;
  errorLogger: IMidwayLogger;

  constructor() {
    this.accessLogger = loggers.getPrettySink('access.log');
    this.errorLogger = loggers.getPrettySink('error.log');
  }

  error(funcName: string, err: Error, requestId: string) {
    this.errorLogger.write(
      `[${new Date().toISOString()}] "${requestId}" ${
        process.pid
      } "${funcName}" -`,
      err
    );
  }

  access(
    funcName: string,
    metadata: Metadata,
    rt: number,
    status: string,
    bytesSent: number,
    requestId?: string
  ) {
    // "[${time}] ${requestId} ${pid} ${funcName}" ${method} "${url}" ${success} "${request_time}"
    // ${status} ${bytes_sent}
    const { method = '-', url = '-' } = metadata;

    this.accessLogger.write(
      `[${new Date().toISOString()}] "${requestId}" ${
        process.pid
      } "${funcName}" ${method} ` +
        `"${url}" ${`${status}` === '200'} "${rt}ms" ${status} ${bytesSent}`
    );
  }
}
