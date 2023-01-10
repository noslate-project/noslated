import loggers from '#self/lib/logger';
import { IMidwayLogger } from '@midwayjs/logger';

export class StatLogger {
  private exitLogger: IMidwayLogger;

  constructor() {
    this.exitLogger = loggers.getPrettySink('resource_usage.log');
  }

  exit(
    funcName: string,
    pid: number,
    exitCode: number | null,
    exitSignal: number | null,
    cpuUsage: number,
    rss: number,
    requestId: string | null
  ) {
    this.exitLogger.write(
      `[${new Date().toISOString()}] "${funcName}" "${
        requestId ?? null
      }" ${pid} ${exitCode}` + ` ${exitSignal} ${cpuUsage} ${rss}`
    );
  }
}
