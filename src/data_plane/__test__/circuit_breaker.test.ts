import assert from 'assert';
import _ from 'lodash';

import * as common from '#self/test/common';
import FakeTimer, { Clock } from '@sinonjs/fake-timers';
import { SystemCircuitBreaker } from '#self/data_plane/circuit_breaker';

describe(common.testName(__filename), () => {
  /** @type {SystemCircuitBreaker} */
  let breaker: SystemCircuitBreaker;
  /** @type {FakeTimer.Clock} */
  let clock: Clock;
  beforeEach(() => {
    clock = FakeTimer.install({
      toFake: ['setInterval'],
    });
  });
  afterEach(() => {
    breaker.close();
    clock.uninstall();
  });
  describe('SystemCircuitBreaker', () => {
    it('should open circuit breaker on request count exceeded limit', () => {
      breaker = new SystemCircuitBreaker({} as any, {
        requestCountLimit: 2,
        pendingRequestCountLimit: 5,
        systemLoad1Limit: 1,
      });
      breaker.start();

      /** request count = active request count + pending request count */
      breaker._getActiveRequestCount = () => 1;
      breaker._getPendingRequestCount = () => 2;
      breaker._getOsLoad1 = () => 0;

      let statusChangedCount = 0;
      breaker.on('status-changed', () => {
        statusChangedCount++;
      });
      _.times(4, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, false);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, true);
      assert.strictEqual(statusChangedCount, 1);

      breaker._getPendingRequestCount = () => 0;
      _.times(2, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, true);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, false);
      assert.strictEqual(statusChangedCount, 2);
    });

    it('should open circuit breaker on pending request count exceeded limit', () => {
      breaker = new SystemCircuitBreaker({} as any, {
        requestCountLimit: 5,
        pendingRequestCountLimit: 1,
        systemLoad1Limit: 1,
      });
      breaker.start();

      /** request count = active request count + pending request count */
      breaker._getActiveRequestCount = () => 1;
      breaker._getPendingRequestCount = () => 2;
      breaker._getOsLoad1 = () => 0;

      let statusChangedCount = 0;
      breaker.on('status-changed', () => {
        statusChangedCount++;
      });
      _.times(4, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, false);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, true);
      assert.strictEqual(statusChangedCount, 1);

      breaker._getPendingRequestCount = () => 0;
      _.times(2, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, true);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, false);
      assert.strictEqual(statusChangedCount, 2);
    });

    it('should open circuit breaker on system load1 exceeded limit', () => {
      breaker = new SystemCircuitBreaker({} as any, {
        requestCountLimit: 1,
        pendingRequestCountLimit: 1,
        systemLoad1Limit: 1,
      });
      breaker.start();

      /** request count = active request count + pending request count */
      breaker._getActiveRequestCount = () => 0;
      breaker._getPendingRequestCount = () => 0;
      breaker._getOsLoad1 = () => 2;

      let statusChangedCount = 0;
      breaker.on('status-changed', () => {
        statusChangedCount++;
      });
      _.times(4, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, false);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, true);
      assert.strictEqual(statusChangedCount, 1);

      breaker._getOsLoad1 = () => 0.999;
      _.times(2, () => {
        clock.tick(1000);
        assert.strictEqual(breaker.opened, true);
      });
      clock.tick(1000);
      assert.strictEqual(breaker.opened, false);
      assert.strictEqual(statusChangedCount, 2);
    });
  });
});
