import { ILogger } from '@midwayjs/logger';
import { ConcurrencyStats } from './concurrency_stats';

export class InstantConcurrencyStats extends ConcurrencyStats {
  private currentConcurrency = 0;

  public requestStarted(): number {
    this.currentConcurrency += 1;
    return 0;
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
