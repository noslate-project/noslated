import { Readable, ReadableOptions } from 'stream';
import { kDefaultRequestId } from '#self/lib/constants';

interface MetadataInit {
  url?: string;
  method?: string;
  headers?: [string, string][];
  baggage?: [string, string][];
  timeout?: number;
  requestId?: string;
}

class Metadata {
  #url;
  #method;
  #headers;
  #baggage;
  #timeout;
  #requestId;

  constructor(init: MetadataInit) {
    this.#url = init?.url;
    this.#method = init?.method ?? 'GET';
    this.#headers = init?.headers ?? [];
    this.#baggage = init?.baggage ?? [];
    this.#timeout = init?.timeout ?? 10_000;
    this.#requestId = init.requestId ?? kDefaultRequestId;
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

  get timeout() {
    return this.#timeout;
  }

  get requestId() {
    return this.#requestId;
  }

  toJSON() {
    return {
      url: this.url,
      method: this.method,
      headers: this.headers,
      baggage: this.baggage,
      timeout: this.timeout,
      requestId: this.requestId
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

export {
  Metadata,
  MetadataInit,
  TriggerResponse,
  flattenKeyValuePairs,
};
