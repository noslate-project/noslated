import assert from 'assert';
import { ILogger } from '@midwayjs/logger';
import sinon from 'sinon';
import * as common from '#self/test/common';
import { InstantConcurrencyStats } from '#self/lib/concurrency_stats/instant_concurrency_stats';

describe(common.testName(__filename), () => {
  let instantConcurrencyStats: InstantConcurrencyStats;
  let mockLogger: sinon.SinonMock;
  let logger: ILogger;

  beforeEach(() => {
    logger = {
      warn: function () {},
    } as unknown as ILogger;

    mockLogger = sinon.mock(logger);
    instantConcurrencyStats = new InstantConcurrencyStats(logger);
  });

  afterEach(() => {
    mockLogger.verify();
  });

  it('should start with zero current concurrency', () => {
    assert.equal(instantConcurrencyStats.getConcurrency(), 0);
  });

  it('should increment current concurrency on requestStarted', () => {
    instantConcurrencyStats.requestStarted();
    assert.equal(instantConcurrencyStats.getConcurrency(), 1);
  });

  it('should decrement current concurrency on requestFinished', () => {
    instantConcurrencyStats.requestStarted();
    instantConcurrencyStats.requestStarted();
    instantConcurrencyStats.requestFinished();
    assert.equal(instantConcurrencyStats.getConcurrency(), 1);
  });

  it('should log a warning and reset current concurrency if requestFinished is called more times than requestStarted', () => {
    // Expect the warning to be logged exactly once
    mockLogger
      .expects('warn')
      .withExactArgs(
        '[InstantConcurrencyStats] currentConcurrency < 0, reset to 0.'
      )
      .once();

    // Force the currentConcurrency to go below zero
    instantConcurrencyStats.requestFinished();

    // Verify the value has been reset to zero
    assert.equal(instantConcurrencyStats.getConcurrency(), 0);
  });

  it('should return the correct current concurrency when getConcurrency is called', () => {
    instantConcurrencyStats.requestStarted();
    instantConcurrencyStats.requestStarted();
    instantConcurrencyStats.requestFinished();
    assert.equal(instantConcurrencyStats.getConcurrency(), 1);

    instantConcurrencyStats.requestStarted();
    assert.equal(instantConcurrencyStats.getConcurrency(), 2);
  });
});
