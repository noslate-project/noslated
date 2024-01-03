import { Loggers } from '#self/lib/loggers';
import { ILogger } from '@midwayjs/logger';
import { Config } from '#self/config';
import dayjs from 'dayjs';
import { kDefaultRequestId } from '#self/lib/constants';

export class StatLogger {
  private exitLogger: ILogger;
  private timestampFormat: string;

  constructor(public config: Config) {
    this.exitLogger = Loggers.getPrettySink('resource_usage.log');
    this.timestampFormat = this.config.logger.timestampFormat;
  }

  exit(
    funcName: string,
    workerName: string,
    pid: number,
    cpuUsage: number,
    rss: number,
    // will >=0 if given
    exitCode = -1,
    // will >=0 if given
    exitSignal = -1,
    requestId: string = kDefaultRequestId
  ) {
    // logTime, dataPlanePid, requestId, functionName, workerName, exitCode, exitSignal, cpuUsage, rss
    this.exitLogger.write(
      `${dayjs().format(
        this.timestampFormat
      )} ${pid} ${requestId} ${funcName} ${workerName} ${exitCode} ${exitSignal} ${cpuUsage} ${rss}`
    );
  }
}
