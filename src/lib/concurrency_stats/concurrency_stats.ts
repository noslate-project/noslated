import { ILogger } from '@midwayjs/logger';

export abstract class ConcurrencyStats {
  constructor(protected logger: ILogger) {}

  abstract requestStarted(): number;

  abstract requestFinished(id?: number): void;

  abstract getConcurrency(): number;
}
