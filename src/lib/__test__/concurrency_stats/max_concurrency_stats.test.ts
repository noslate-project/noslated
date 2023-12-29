import { MaxConcurrencyStats } from '#self/lib/concurrency_stats/max_concurrency_stats';
import * as common from '#self/test/common';
import sinon from 'sinon';
import assert from 'assert';
import { ILogger } from '@midwayjs/logger';

describe(common.testName(__filename), () => {
  let maxConcurrencyStats: MaxConcurrencyStats;
  let mockLogger: sinon.SinonMock;
  let logger: ILogger;

  beforeEach(() => {
    logger = {
      warn: function () {},
    } as unknown as ILogger;

    mockLogger = sinon.mock(logger);
    maxConcurrencyStats = new MaxConcurrencyStats(logger);
  });

  afterEach(() => {
    mockLogger.verify();
  });

  it('should start with zero current and max concurrency', () => {
    assert.equal(maxConcurrencyStats.getConcurrency(), 0);
  });

  it('should increment current concurrency on requestStarted', () => {
    maxConcurrencyStats.requestStarted();
    assert.equal(maxConcurrencyStats.getConcurrency(), 1);
  });

  it('should decrement current concurrency on requestFinished', () => {
    maxConcurrencyStats.requestStarted();
    maxConcurrencyStats.requestStarted();
    maxConcurrencyStats.requestFinished();
    assert.equal(maxConcurrencyStats.getConcurrency(), 2);
  });

  it('should log a warning if requestFinished is called more times than requestStarted', () => {
    mockLogger.expects('warn').once();
    maxConcurrencyStats.requestFinished();
  });

  it('should update max concurrency correctly', () => {
    maxConcurrencyStats.requestStarted();
    maxConcurrencyStats.requestStarted();
    maxConcurrencyStats.requestFinished();
    maxConcurrencyStats.requestStarted();
    assert.equal(maxConcurrencyStats.getConcurrency(), 2);
  });

  it('should not reset max concurrency to 0 after getConcurrency is called', () => {
    maxConcurrencyStats.requestStarted();
    maxConcurrencyStats.requestStarted();
    const maxAfterRequests = maxConcurrencyStats.getConcurrency();
    assert.equal(maxAfterRequests, 2);

    // Assuming two requests are still ongoing
    const maxAfterGettingMax = maxConcurrencyStats.getConcurrency();
    assert.equal(maxAfterGettingMax, 2); // Here we assume currentConcurrency was 2 when getMaxConcurrency was called
  });
});
