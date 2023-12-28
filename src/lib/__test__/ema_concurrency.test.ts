import * as common from '#self/test/common';
import { EMAConcurrency } from '#self/lib/ema_concurrency';
import sinon from 'sinon';
import assert from 'assert';

const DELTA = 1e-10; // 允许的误差范围

describe(common.testName(__filename), () => {
  const windowSize = 60000;
  const bucketCount = 6;
  const alpha = 0.5;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
  });

  afterEach(() => {
    clock.restore();
  });

  it('should initialize properly', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);
    assert.strictEqual(ema.concurrency(), 0);
  });

  it('should update concurrency correctly within the same bucket', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);
    ema.recalculate(10);
    // 10 0 0 0 0 0
    assert.strictEqual(ema.concurrency(), (10 / 6) * alpha);
    // bucket time size 10s，same bucket
    clock.tick(5000);
    // 20 0 0 0 0 0
    ema.recalculate(20);
    // 需要参考之前的计算结果，新的 ema 结果是之前结果的 50% + 新的均值 50%
    const expectedEMA =
      alpha * (20 / bucketCount) + alpha * ((10 / bucketCount) * alpha);
    assert(Math.abs(ema.concurrency() - expectedEMA) < DELTA);
  });

  it('should clear the correct buckets when time advances but not clear the emaConcurrency', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);
    ema.recalculate(10);
    // 10 0 0 0 0 0
    // 跳两个 bucket
    clock.tick(20000);
    // 10 0 20 0 0 0
    ema.recalculate(20);
    // 因为过程中没有重新计算 ema，旧值仍会影响新值
    const previousEMA = (10 / bucketCount) * alpha;
    const newBucketValue = 20 / bucketCount;
    const expectedEMA = alpha * newBucketValue + alpha * previousEMA;
    assert(Math.abs(ema.concurrency() - expectedEMA) < DELTA);
  });

  it('should not reset emaConcurrency when time exceeds window size', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);
    ema.recalculate(10);
    // 10 0 0 0 0 0
    // 跳过一个 windowSize
    clock.tick(60000);
    // 10 20 0 0 0 0
    ema.recalculate(20);
    // 因为过程中没有重新计算 ema，旧值仍会影响新值
    const previousEMA = (10 / bucketCount) * alpha;
    const newBucketValue = 20 / bucketCount;
    const expectedEMA = alpha * newBucketValue + alpha * previousEMA;
    assert(Math.abs(ema.concurrency() - expectedEMA) < DELTA);
  });

  it('should handle recalculation after long periods of inactivity', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);
    // 10 0 0 0 0 0
    ema.recalculate(10);
    // 过了 5min
    clock.tick(300000);
    // 20 0 0 0 0 0
    ema.recalculate(20);
    // 因为过程中没有重新计算 ema，旧值仍会影响新值
    const newBucketValue = 20 / bucketCount;
    const previousEMA = (10 / bucketCount) * alpha;
    const expectedEMA = alpha * newBucketValue + alpha * previousEMA;
    assert(Math.abs(ema.concurrency() - expectedEMA) < DELTA);
  });

  it('should gradually reduce emaConcurrency to near zero with prolonged zero activity', () => {
    const ema = new EMAConcurrency(windowSize, bucketCount, alpha);

    // 初始设定并发度为 1
    ema.recalculate(1);

    // 每个 windowSize 更新一次 recalculate(0), 模拟长时间的零活动
    for (let i = 0; i < 300000; i += windowSize) {
      clock.tick(windowSize);
      ema.recalculate(0);
    }

    assert.strictEqual(ema.concurrency(), 0);
  });
});
