import * as common from '#self/test/common';
import { AvgConcurrencyStats } from '#self/lib/concurrency_stats/avg_concurrency_stats';
import assert from 'assert';
import { sleep } from '#self/lib/util';
import { assertCloseTo } from '#self/test/util';

describe(common.testName(__filename), function () {
  this.timeout(30_000);

  it('should calculate concurrency correctly', async () => {
    const calculator: AvgConcurrencyStats = new AvgConcurrencyStats(console);
    // 假设有三个请求同时到达
    const r1 = calculator.requestStarted();
    const r2 = calculator.requestStarted();
    const r3 = calculator.requestStarted();

    // 请求结束
    setTimeout(() => calculator.requestFinished(r1), 100);
    setTimeout(() => calculator.requestFinished(r2), 200);
    setTimeout(() => calculator.requestFinished(r3), 1500);

    await sleep(1000);
    // 剩一个 1500 未结束
    // (3 / 1) * (((100 + 200 + 1000) / 3) / 1000)
    assertCloseTo(calculator.getConcurrency(), 1.3, 0.01);

    await sleep(1000);
    // 1500 的剩 500
    // (1 / 1) * (((500) / 1) / 1000)
    assertCloseTo(calculator.getConcurrency(), 0.5, 0.01);

    await sleep(1000);
    assert.strictEqual(calculator.getConcurrency(), 0);
  });
});
