import { Metadata } from '#self/delegate/request_response';
import loggers from '#self/lib/logger';
import { IMidwayLogger } from '@midwayjs/logger';
import { kDefaultRequestId, kDefaultWorkerName } from '#self/lib/constants';
import { Config } from '#self/config';
import dayjs from 'dayjs';

export class RequestLogger {
  accessLogger: IMidwayLogger;
  errorLogger: IMidwayLogger;

  constructor(public config: Config) {
    this.accessLogger = loggers.getPrettySink('access.log');
    this.errorLogger = loggers.getPrettySink('error.log');
  }

  error(
    funcName: string,
    workerName: string = kDefaultWorkerName,
    err: Error,
    requestId: string = kDefaultRequestId
  ) {
    // logTime, dataPlanePid, requestId, functionName, workerName, error
    this.errorLogger.write(
      `${dayjs().format(this.config.logger.timestampFormat)} ${process.pid} ${requestId} ${funcName} ${workerName} - `,
      err
    );
  }

  access(
    funcName: string,
    workerName: string = kDefaultWorkerName,
    metadata: Metadata,
    start: number,
    end: number,
    status: string,
    bytesSent: number,
    requestId: string = kDefaultRequestId,
    performance: RequestPerformance,
  ) {
    // logTime, dataPlanePid, requestId, functionName, workerName, method, url, invokeSuccess, timeToFirstByte, timeForQueueing, rt, statusCode, responseSize
    const { method = '-', url = '-' } = metadata;
    const { ttfb, queueing } = performance;

    this.accessLogger.write(
      `${dayjs().format(this.config.logger.timestampFormat)} ${requestId} ${process.pid} ${funcName} ${workerName} ${method} ${url} ` +
      `${`${status}` === '200'} ${ttfb - start} ${queueing} ${end - start} ${status} ${bytesSent}`
    );
  }
}

export interface RequestPerformance {
  ttfb: number;
  queueing: number;
}
