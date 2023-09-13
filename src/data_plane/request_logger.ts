import { Metadata } from '#self/delegate/request_response';
import loggers from '#self/lib/logger';
import { IMidwayLogger } from '@midwayjs/logger';
import { kDefaultRequestId, kDefaultWorkerName } from '#self/lib/constants';
import { Config } from '#self/config';
import dayjs from 'dayjs';

export class RequestLogger {
  accessLogger: IMidwayLogger;
  errorLogger: IMidwayLogger;
  private timestampFormat: string;

  constructor(public config: Config) {
    this.accessLogger = loggers.getPrettySink('access.log');
    this.errorLogger = loggers.getPrettySink('error.log');
    this.timestampFormat = this.config.logger.timestampFormat;
  }

  error(
    funcName: string,
    workerName: string = kDefaultWorkerName,
    err: Error,
    requestId: string = kDefaultRequestId
  ) {
    // logTime, requestId, dataPlanePid, functionName, workerName, error
    this.errorLogger.write(
      `${dayjs().format(this.timestampFormat)} ${requestId} ${
        process.pid
      } ${funcName} ${workerName} - `,
      err
    );
  }

  access(
    funcName: string,
    workerName: string = kDefaultWorkerName,
    metadata: Metadata,
    status: string = `${TriggerErrorStatus.DEFAULT}`,
    performance: RequestTiming,
    bytesSent: number = 0
  ) {
    // logTime, requestId, dataPlanePid, functionName, workerName, method, url, invokeSuccess, timeToFirstByte, timeForQueueing, rt, statusCode, responseSize
    const { method = '-', url = '-', requestId = kDefaultRequestId } = metadata;
    const { ttfb = 0, queueing = 0, rt = 0 } = performance;

    this.accessLogger.write(
      `${dayjs().format(this.timestampFormat)} ${requestId} ${
        process.pid
      } ${funcName} ${workerName} ${method} ${url} ` +
        `${
          `${status}` === '200'
        } ${ttfb} ${queueing} ${rt} ${status} ${bytesSent}`
    );
  }
}

export interface RequestTiming {
  // 请求排队时间，即到达系统至 worker 执行请求的时间
  queueing: number;
  // 响应首包返回时间，time to first byte
  ttfb: number;
  // 请求 RT，响应发送完毕
  rt: number;
}

export enum TriggerErrorStatus {
  DEFAULT = 0,
  INTERNAL = -1,
  ABORT = -2,
}
