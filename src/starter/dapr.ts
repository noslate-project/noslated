import { NoslatedClient } from './util';

function objectToKeyValueMap(object: object) {
  const entries = Object.entries(object)
    .map(([ key, value ]) => [ key, `${value}` ]);
  return Object.fromEntries(entries);
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
  metadata?: any;
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
    this.#metadata = init.metadata ? objectToKeyValueMap(init.metadata) : {};
    this.#operation = `${init.operation ?? ''}`;
    this.#dataSource = init.body ?? '';
    this.#timeout = init.timeout ?? 10_000;
  }

  get name() {
    return this.#name;
  }

  get metadata() {
    return { ...this.#metadata };
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
}

class Response {
  #status;
  #data;
  constructor(init: ResponseInit) {
    this.#status = init.status;
    this.#data = init.data;
  }

  get status() {
    return this.#status;
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
        const res = await client.daprInvoke(req.app, req.method, data, req.timeout);
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
        const res = await client.daprBinding(req.name, JSON.stringify(req.metadata), req.operation, data, req.timeout);
        return new Response(res);
      },
    },
  };
}

export interface Context {
  Dapr: ReturnType<typeof makeDapr>;
}
