import { ILogger } from '@midwayjs/logger';
import { ConcurrencyStats } from './concurrency_stats';

export class AvgConcurrencyStats extends ConcurrencyStats {
  activeRequests: number;
  totalActiveTime: bigint;
  startTime: bigint;

  constructor(logger: ILogger) {
    super(logger);

    this.activeRequests = 0;
    this.totalActiveTime = 0n;
    this.startTime = process.hrtime.bigint();
  }

  requestStarted() {
    this.activeRequests++;
  }

  requestFinished() {
    if (this.activeRequests > 0) {
      this.totalActiveTime += process.hrtime.bigint() - this.startTime;
      this.activeRequests--;
    }
  }

  getConcurrency() {
    const currentTime = process.hrtime.bigint();
    let activeTime = this.totalActiveTime;
    // 如果存在活跃请求，添加当前活跃请求的活动时间
    if (this.activeRequests > 0) {
      activeTime += currentTime - this.startTime;
    }
    const timeSinceStart = currentTime - this.startTime;
    let avgConcurrency = 0;

    if (timeSinceStart > 0n) {
      avgConcurrency = Number(activeTime) / Number(timeSinceStart);
    }

    // 重置累积的活跃时间，为下一个窗口做准备
    this.totalActiveTime = 0n;
    this.startTime = currentTime;

    return avgConcurrency;
  }
}
