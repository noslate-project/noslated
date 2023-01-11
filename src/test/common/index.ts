import path from 'path';
import assert from 'assert';
import { FIXTURES_DIR } from '../util';
import FakeTimers from '@sinonjs/fake-timers';
import { Clock } from '#self/lib/clock';

const srcRoot = path.resolve(__dirname, '../..');

export function testName(filename: string) {
  return path.relative(srcRoot, filename);
}

export function assertApproxEquals(lhs: number, rhs: number, approx: number) {
  const delta = Math.abs(lhs - rhs);
  assert.ok(
    delta < approx,
    `Expect lhs(${lhs}) and rhs(${rhs}) to be in an approximate delta(${approx})`
  );
}

export interface TestClockOptions {
  shouldAdvanceTime?: boolean;
}

export interface TestClock extends Clock {
  fakeClock: FakeTimers.Clock;
  tick: FakeTimers.Clock['tick'];
  tickAsync: FakeTimers.Clock['tickAsync'];
  uninstall: () => void;
}

export function createTestClock(options?: TestClockOptions): TestClock {
  const fakeClock = FakeTimers.createClock();
  let advanceInterval: ReturnType<typeof setInterval>;
  if (options?.shouldAdvanceTime) {
    advanceInterval = setInterval(() => {
      fakeClock.tick(20);
    }, 20);
  }

  return {
    setTimeout: fakeClock.setTimeout,
    clearTimeout: fakeClock.clearTimeout,
    setInterval: fakeClock.setInterval,
    clearInterval: fakeClock.clearInterval,
    now: fakeClock.Date.now,

    fakeClock,
    tick: fakeClock.tick,
    tickAsync: fakeClock.tickAsync,
    uninstall: () => {
      clearInterval(advanceInterval);
    },
  };
}

export const baselineDir = path.join(FIXTURES_DIR, 'baseline');
export const daprAdaptorDir = path.join(FIXTURES_DIR, 'dapr_adaptor');
