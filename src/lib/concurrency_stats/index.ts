import { ConcurrencyStatsMode } from '#self/lib/json/function_profile';
import { ConcurrencyStats } from './concurrency_stats';
import { AvgConcurrencyStats } from './avg_concurrency_stats';
import { InstantConcurrencyStats } from './instant_concurrency_stats';
import { MaxConcurrencyStats } from './max_concurrency_stats';

const logger = require('#self/lib/logger').get('concurrency stats');

export class ConcurrencyStatsFactory {
  public static factory(mode: ConcurrencyStatsMode): ConcurrencyStats {
    switch (mode) {
      case ConcurrencyStatsMode.PERIODIC_AVG:
        return new AvgConcurrencyStats(logger);
      case ConcurrencyStatsMode.PERIODIC_MAX:
        return new MaxConcurrencyStats(logger);
      case ConcurrencyStatsMode.INSTANT:
      default:
        return new InstantConcurrencyStats(logger);
    }
  }
}

export { ConcurrencyStats } from './concurrency_stats';
