/**
 * 使用 指数移动平均 计算并发度
 */
export class EMAConcurrency {
  // 指数移动平均并发度
  private emaConcurrency = 0;
  private buckets: number[];
  private lastUpdateTime: number;

  /**
   * @param windowSize 滑动窗口大小，单位 ms
   * @param bucketCount 窗口时间分桶数
   * @param alpha 指数平滑系数（0 < alpha <= 1）
   * @param precisionZeroThreshold emaConcurrency 小于该值则视为 0
   */
  constructor(
    private windowSize: number,
    private bucketCount: number,
    private alpha: number,
    private precisionZeroThreshold: number = 0.01
  ) {
    this.buckets = Array(this.bucketCount).fill(0);
    this.lastUpdateTime = Date.now();
  }

  recalculate(concurrency: number) {
    const now = Date.now();
    const timeDelta = now - this.lastUpdateTime;
    const bucketIndex = Math.floor(
      (now % this.windowSize) / (this.windowSize / this.bucketCount)
    );

    // (] 左开右闭
    if (timeDelta >= this.windowSize) {
      // 如果距离上次更新超过了窗口大小，则清空所有桶
      this.buckets.fill(0);
      // 不重置 emaConcurrency，防止短期的负载峰值频繁扩缩容
      // TODO: 观察下如果需要快速响应，则直接重置为 0
      if (this.emaConcurrency < this.precisionZeroThreshold) {
        this.emaConcurrency = 0;
      }
    } else {
      // 清空即将更新的桶，因为它已经不再代表最新时间段的数据
      this.buckets[bucketIndex] = 0;

      // 如果时间跨度超过了单个桶的大小，
      // 清空所有在上次更新时间和当前时间之间的桶
      if (timeDelta > this.windowSize / this.bucketCount) {
        const bucketsToClear = Math.ceil(
          timeDelta / (this.windowSize / this.bucketCount)
        );
        for (let i = 1; i <= bucketsToClear; i++) {
          const indexToClear =
            (bucketIndex - i + this.bucketCount) % this.bucketCount;
          this.buckets[indexToClear] = 0;
        }
      }
    }

    // 更新当前桶的并发度，覆盖，防止累计值将并发度拉高
    this.buckets[bucketIndex] = concurrency;

    // 更新 EMA 并发度
    const averageConcurrency =
      this.buckets.reduce((sum, concurrency) => sum + concurrency, 0) /
      this.bucketCount;
    this.emaConcurrency =
      this.alpha * averageConcurrency + (1 - this.alpha) * this.emaConcurrency;

    if (this.emaConcurrency < this.precisionZeroThreshold) {
      this.emaConcurrency = 0;
    }
    this.lastUpdateTime = now;
  }

  concurrency() {
    return this.emaConcurrency;
  }
}
