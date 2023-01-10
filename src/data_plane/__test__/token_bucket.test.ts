import assert from 'assert';

import * as common from '#self/test/common';
import { TokenBucket } from '#self/data_plane/token_bucket';
import FakeTimer, { Clock } from '@sinonjs/fake-timers';

describe(common.testName(__filename), () => {
  /** @type {TokenBucket} */
  let tokenBucket: TokenBucket;
  /** @type {FakeTimer.Clock} */
  let clock: Clock;
  beforeEach(() => {
    clock = FakeTimer.install({
      toFake: ['setInterval'],
    });
  });
  afterEach(() => {
    tokenBucket?.close();
    clock.uninstall();
  });

  it('should throw error when not start', () => {
    tokenBucket = new TokenBucket({ maxTokenCount: 1 });

    assert.throws(
      () => {
        tokenBucket.acquire();
      },
      {
        message: 'rate limit unavailable',
      }
    );
  });

  it('should pass when config is empty', () => {
    tokenBucket = new TokenBucket();
    tokenBucket.start();

    assert.strictEqual(tokenBucket.acquire(), true);

    clock.tick(1);

    assert.strictEqual(tokenBucket.acquire(), true);
  });

  it('should not refill when fillInterval is undefined', () => {
    tokenBucket = new TokenBucket({
      maxTokenCount: 1,
      tokensPerFill: 2,
    });

    tokenBucket.start();

    assert.strictEqual(tokenBucket.acquire(), true);

    clock.tick(1);

    assert.strictEqual(tokenBucket.acquire(), false);
  });

  it('should refill maxTokenCount when tokensPerFill is undefined', () => {
    tokenBucket = new TokenBucket({
      maxTokenCount: 2,
      fillInterval: 1,
    });

    tokenBucket.start();

    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), false);

    clock.tick(1);

    assert.strictEqual(tokenBucket.acquire(), true);

    clock.tick(1);

    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), false);
  });

  it('should reject acquisition on no token available', () => {
    tokenBucket = new TokenBucket({
      maxTokenCount: 1,
      tokensPerFill: 1,
      fillInterval: 1,
    });
    tokenBucket.start();

    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), false);
    assert.strictEqual(tokenBucket.acquire(), false);

    clock.tick(1);
    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.acquire(), false);
    assert.strictEqual(tokenBucket.acquire(), false);
  });

  it('should not refill tokens exceeding max token count', () => {
    tokenBucket = new TokenBucket({
      maxTokenCount: 1,
      /** single fill that exceeding the max token count  */
      tokensPerFill: 2,
      fillInterval: 1,
    });
    tokenBucket.start();

    assert.strictEqual(tokenBucket.tokenCount, 1);
    assert.strictEqual(tokenBucket.acquire(), true);
    assert.strictEqual(tokenBucket.tokenCount, 0);

    clock.tick(1);
    assert.strictEqual(tokenBucket.tokenCount, 1);

    clock.tick(1);
    clock.tick(1);
    clock.tick(1);
    assert.strictEqual(tokenBucket.tokenCount, 1);
  });
});
