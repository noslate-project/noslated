import { ILogger } from '@midwayjs/logger';

export abstract class ConcurrencyStats {
  constructor(protected logger: ILogger) {}

  abstract requestStarted(): void;

  abstract requestFinished(): void;

  abstract getConcurrency(): number;
}
