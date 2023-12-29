import { ILogger } from '@midwayjs/logger';
import { ConcurrencyStats } from './concurrency_stats';

export class MaxConcurrencyStats extends ConcurrencyStats {
  private currentConcurrency = 0;
  private maxConcurrency = 0;

  public requestStarted(): number {
    this.currentConcurrency += 1;
    this.maxConcurrency = Math.max(
      this.maxConcurrency,
      this.currentConcurrency
    );
    return 0;
  }

  public requestFinished(): void {
    this.currentConcurrency -= 1;

    if (this.currentConcurrency < 0) {
      this.logger.warn(
        '[MaxConcurrencyStats] currentConcurrency < 0, reset to 0.'
      );
      this.currentConcurrency = 0;
    }
  }

  // 获取当前最大并发度，并重置数据为当前并发度
  public getConcurrency(): number {
    const currentMaxConcurrency = this.maxConcurrency;
    this.maxConcurrency = this.currentConcurrency;

    return currentMaxConcurrency;
  }
}
