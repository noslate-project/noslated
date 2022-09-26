export class TokenBucket {
  #tokenCount: number = 0;
  #maxTokenCount: number = 0;
  #config: TokenBucketConfig;
  #started: boolean = false;

  #refill = () => {
    if (this.#config.tokensPerFill) {
      this.#tokenCount = Math.min(this.#tokenCount + this.#config.tokensPerFill, this.#maxTokenCount);
    } else {
      this.#tokenCount = this.#maxTokenCount;
    }
  }

  #refillInterval: NodeJS.Timer | undefined;

  constructor(config: TokenBucketConfig = {}) {
    this.#config = config;
    this.#maxTokenCount = this.#config.maxTokenCount ?? Infinity;
    this.#tokenCount = this.#maxTokenCount;
    this.#refillInterval = undefined;
  }

  get tokenCount() {
    return this.#tokenCount;
  }

  acquire() {
    if (!this.#started) {
      throw new Error('rate limit unavailable');
    }

    if (this.#tokenCount <= 0) {
      return false;
    }

    // Infinity-- is Infinity
    this.#tokenCount--;
    return true;
  }

  start() {
    this.#started = true;

    if (this.#config.fillInterval) {
      this.#refillInterval = setInterval(this.#refill, this.#config.fillInterval);
    }
  }

  close() {
    this.#started = false;
    this.#tokenCount = 0;
    clearInterval(this.#refillInterval);
  }
}

export interface TokenBucketConfig {
  maxTokenCount?: number;
  tokensPerFill?: number;
  fillInterval?: number;
}
