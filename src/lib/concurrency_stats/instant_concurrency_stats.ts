import { ILogger } from '@midwayjs/logger';
import { ConcurrencyStats } from './concurrency_stats';

export class InstantConcurrencyStats extends ConcurrencyStats {
  private currentConcurrency = 0;

  public requestStarted(): void {
    this.currentConcurrency += 1;
  }

  public requestFinished(): void {
    this.currentConcurrency -= 1;

    if (this.currentConcurrency < 0) {
      this.logger.warn(
        '[InstantConcurrencyStats] currentConcurrency < 0, reset to 0.'
      );
      this.currentConcurrency = 0;
    }
  }

  // 获取当前最大并发度，并重置数据
  public getConcurrency(): number {
    return this.currentConcurrency;
  }
}
