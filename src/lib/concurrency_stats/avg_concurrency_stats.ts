import { ILogger } from '@midwayjs/logger';
import { ConcurrencyStats } from './concurrency_stats';

export class AvgConcurrencyStats extends ConcurrencyStats {
  requestStartTimes: Map<number, bigint>;
  totalActiveTime: bigint;
  startTime: bigint;
  indexId: number;
  requestCount: number;

  constructor(logger: ILogger) {
    super(logger);
    this.requestStartTimes = new Map();
    this.totalActiveTime = 0n;
    this.startTime = process.hrtime.bigint();
    this.indexId = 0;
    this.requestCount = 0;
  }

  requestStarted() {
    const id = ++this.indexId;
    this.requestStartTimes.set(id, process.hrtime.bigint());
    this.requestCount++;

    return id;
  }

  requestFinished(id: number) {
    const start = this.requestStartTimes.get(id);
    const end = process.hrtime.bigint();

    if (start) {
      this.totalActiveTime += end - start;
      this.requestStartTimes.delete(id);
    } else {
      // 上个周期遗留的请求，直接计算，同时也算这个周期处理的请求数
      this.totalActiveTime += end - this.startTime;
      this.requestCount++;
    }
  }

  getConcurrency() {
    const currentTime = process.hrtime.bigint();

    // 计算正在进行的请求 rt
    for (const start of this.requestStartTimes.values()) {
      this.totalActiveTime += currentTime - start;
    }

    if (this.totalActiveTime === 0n) {
      return 0;
    }

    const timeSinceStart = currentTime - this.startTime;

    const avgRTInSeconds =
      Number(this.totalActiveTime) / 1e9 / this.requestCount;
    const estimatedQPS = this.requestCount / (Number(timeSinceStart) / 1e9);

    const avgConcurrency = avgRTInSeconds * estimatedQPS;

    this.totalActiveTime = 0n;
    this.requestStartTimes.clear();
    this.indexId = 0;
    this.requestCount = 0;
    this.startTime = process.hrtime.bigint();

    return avgConcurrency;
  }
}
