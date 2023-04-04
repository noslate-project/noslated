import { Readable, ReadableOptions } from 'stream';
import {
  kDefaultRequestId,
  kDefaultWorkerName,
  kDefaultQueueingTime,
} from '#self/lib/constants';
import { createDeferred } from '#self/lib/util';

interface MetadataInit {
  url?: string;
  method?: string;
  headers?: [string, string][];
  baggage?: [string, string][];
  // homogeneously replaced with [deadline], but reserved for compatibility
  timeout?: number;
  deadline?: number;
  requestId?: string;
}

class Metadata {
  #url;
  #method;
  #headers;
  #baggage;
  #requestId;
  #deadline;

  constructor(init: MetadataInit) {
    this.#url = init?.url;
    this.#method = init?.method ?? 'GET';
    this.#headers = init?.headers ?? [];
    this.#baggage = init?.baggage ?? [];
    this.#requestId = init.requestId ?? kDefaultRequestId;
    this.#deadline = init?.deadline ?? Date.now() + (init.timeout ?? 10_000);
  }

  get url() {
    return this.#url;
  }

  get method() {
    return this.#method;
  }

  get headers() {
    return this.#headers;
  }

  get baggage() {
    return this.#baggage;
  }

  get requestId() {
    return this.#requestId;
  }

  get deadline() {
    return this.#deadline;
  }

  toJSON() {
    return {
      url: this.url,
      method: this.method,
      headers: this.headers,
      baggage: this.baggage,
      requestId: this.requestId,
      deadline: this.deadline,
    };
  }
}

interface TriggerResponseInit {
  read?: ReadableOptions['read'];
  destroy?: ReadableOptions['destroy'];
  status?: number;
  metadata?: MetadataInit | Metadata;
}

class TriggerResponse extends Readable {
  #status;
  #metadata;
  #finishDeferred;
  // time for request wait to be invoked
  #queueing: number;
  #workerName: string;

  constructor(init?: TriggerResponseInit) {
    super({
      read: init?.read,
      destroy: init?.destroy,
    });
    this.#status = init?.status ?? 200;
    let metadata = init?.metadata ?? {};
    if (!(metadata instanceof Metadata)) {
      metadata = new Metadata(metadata);
    }
    this.#metadata = metadata;
    this.#queueing = kDefaultQueueingTime;
    this.#workerName = kDefaultWorkerName;
    this.#finishDeferred = createDeferred<boolean>();

    this.once('close', () => {
      // emit after readable stream be consumed
      this.#finishDeferred.resolve(true);
    });
  }

  get status() {
    return this.#status;
  }

  set status(val) {
    this.#status = val;
  }

  get metadata() {
    return this.#metadata;
  }

  set metadata(val) {
    if (!(val instanceof Metadata)) {
      throw new TypeError('expect a Metadata');
    }
    this.#metadata = val;
  }

  set queueing(cost: number) {
    this.#queueing = cost;
  }

  get queueing(): number {
    return this.#queueing;
  }

  set workerName(name: string) {
    this.#workerName = name;
  }

  get workerName(): string {
    return this.#workerName;
  }

  async finish(): Promise<boolean> {
    return this.#finishDeferred.promise;
  }
}

function flattenKeyValuePairs(pairs: [unknown, unknown][]): string[] {
  const raw: string[] = [];
  if (!Array.isArray(pairs)) {
    throw new TypeError('Expect a key value pairs array');
  }
  for (const pair of pairs) {
    if (!Array.isArray(pair)) {
      throw new TypeError('Expect a key value pair');
    }
    raw.push(String(pair[0]), String(pair[1]));
  }
  return raw;
}

export { Metadata, MetadataInit, TriggerResponse, flattenKeyValuePairs };
