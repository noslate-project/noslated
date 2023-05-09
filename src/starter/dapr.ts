import { aworker } from '#self/proto/aworker';
import { NoslatedClient } from './util';

function objectToKeyValuePairs(
  obj: Record<string, unknown> = {}
): aworker.ipc.IKeyValuePair[] {
  return Object.entries(obj).map(([key, value]) => {
    return { key, value: `${value}` };
  });
}

function keyValuePairsToObject(
  keyValuePairs: aworker.ipc.IKeyValuePair[] = []
): Record<string, string> {
  const obj = Object.create(null);
  keyValuePairs.forEach(kv => {
    obj[kv.key] = kv.value;
  });
  return obj;
}

type BufferSource = Buffer | Uint8Array | string;
interface ServiceRequestInit {
  app?: string;
  method?: string;
  body?: BufferSource;
  timeout?: number;
}

class ServiceRequest {
  #app;
  #method;
  #bodySource;
  #timeout;
  constructor(init: ServiceRequestInit = {}) {
    this.#app = `${init.app ?? ''}`;
    this.#method = `${init.method ?? ''}`;
    this.#bodySource = init.body ?? '';
    this.#timeout = init.timeout ?? 10_000;
  }

  get app() {
    return this.#app;
  }

  get method() {
    return this.#method;
  }

  get timeout() {
    return this.#timeout;
  }

  async buffer() {
    return Buffer.from(this.#bodySource);
  }
}

interface BindingRequestInit {
  name?: string;
  metadata?: Record<string, string>;
  operation?: string;
  body?: BufferSource;
  timeout?: number;
}

class BindingRequest {
  #name;
  #metadata;
  #operation;
  #dataSource;
  #timeout;
  constructor(init: BindingRequestInit = {}) {
    this.#name = `${init.name ?? ''}`;
    this.#metadata = init.metadata ? objectToKeyValuePairs(init.metadata) : [];
    this.#operation = `${init.operation ?? ''}`;
    this.#dataSource = init.body ?? '';
    this.#timeout = init.timeout ?? 10_000;
  }

  get name() {
    return this.#name;
  }

  get metadata() {
    return [...this.#metadata];
  }

  get operation() {
    return this.#operation;
  }

  get timeout() {
    return this.#timeout;
  }

  async buffer() {
    return Buffer.from(this.#dataSource);
  }
}

interface ResponseInit {
  status: number;
  data: Buffer | Uint8Array;
  metadata?: aworker.ipc.IKeyValuePair[] | null;
}

class Response {
  #status;
  #data;
  #metadata;

  constructor(init: ResponseInit) {
    this.#status = init.status;
    this.#data = init.data;
    this.#metadata = init.metadata ? keyValuePairsToObject(init.metadata) : {};
  }

  get status() {
    return this.#status;
  }

  get metadata() {
    return { ...this.#metadata };
  }

  async json() {
    return JSON.parse(this.#data.toString('utf8'));
  }

  async text() {
    return this.#data.toString('utf8');
  }

  async buffer() {
    return this.#data;
  }
}

export function makeDapr(client: NoslatedClient) {
  return {
    '1.0': {
      ServiceRequest,
      BindingRequest,
      invoke: async (init: ServiceRequestInit | ServiceRequest) => {
        let req: ServiceRequest;
        if (!(init instanceof ServiceRequest)) {
          req = new ServiceRequest(init);
        } else {
          req = init;
        }
        const data = await req.buffer();
        const res = await client.daprInvoke(
          req.app,
          req.method,
          data,
          req.timeout
        );
        return new Response(res);
      },
      binding: async (init: BindingRequestInit | BindingRequest) => {
        let req: BindingRequest;
        if (!(init instanceof BindingRequest)) {
          req = new BindingRequest(init);
        } else {
          req = init;
        }

        const data = await req.buffer();
        const res = await client.daprBinding(
          req.name,
          req.metadata,
          req.operation,
          data,
          req.timeout
        );

        return new Response(res);
      },
    },
  };
}

export interface Context {
  Dapr: ReturnType<typeof makeDapr>;
}
