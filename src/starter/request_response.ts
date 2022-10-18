import type { aworker } from '#self/proto/aworker';
import { STATUS_CODES } from 'http';
import { Readable, Writable } from 'stream';
import type { NoslatedNodeWorker } from './noslated_node';
import { CanonicalCode } from './util';
import { safeError } from './util';

type KeyValuePair = aworker.ipc.IKeyValuePair;
type ErrorResponse = aworker.ipc.IErrorResponseMessage;
type TriggerResponse = aworker.ipc.ITriggerResponseMessage;

export interface MetadataInit {
  url: string;
  method: string;
  headers: KeyValuePair[];
  baggage: KeyValuePair[];
}

export class IncomingMessage extends Readable {
  #url;
  #method;
  #headers;
  #baggage;
  constructor(metadataInit: MetadataInit) {
    super({
      read() {},
    });
    this.#url = metadataInit.url;
    this.#method = metadataInit.method;
    this.#headers = metadataInit.headers.map(it => [it.key, it.value]);
    this.#baggage = metadataInit.baggage.map(it => [it.key, it.value]);
  }

  get headers() {
    return Object.fromEntries(this.#headers);
  }

  get baggage() {
    return Object.fromEntries(this.#baggage);
  }

  get rawHeaders() {
    return this.#headers.flatMap(it => it);
  }

  get method() {
    return this.#method;
  }

  get url() {
    return this.#url;
  }
}

export class ServerResponse extends Writable {
  #headerCallback;
  #headersSent = false;
  #headers = Object.create(null);
  #statusCode = 200;

  #sendHeader = (error?: unknown) => {
    if (error) {
      this.#headerCallback(CanonicalCode.INTERNAL_ERROR, safeError(error), null);
      return;
    }
    const params: TriggerResponse = {
      status: this.#statusCode,
      metadata: {
        headers: Object.entries(this.#headers).flatMap(([ key, val ]) => {
          if (!Array.isArray(val)) {
            return [{ key, value: String(val) }];
          }
          return val.map(it => ({ key, value: it }));
        }),
      },
    };
    this.#headersSent = true;
    this.#headerCallback(CanonicalCode.OK, null, params);
  };

  constructor(worker: NoslatedNodeWorker, sid: number | null, headerCallback: (code: CanonicalCode, err: ErrorResponse | null, data: TriggerResponse | null) => void) {
    super({
      write: (chunk, encoding, callback) => {
        if (sid == null) {
          return callback();
        }
        worker.streamPush(sid, /* isEos */false, chunk, /* isError */false)
          .then(
            () => {
              callback();
            },
            (err: any) => {
              callback(err);
            });
      },
      destroy: (error, callback) => {
        if (!this.#headersSent) {
          this.#sendHeader(error);
        }
        if (sid == null) {
          return callback(null);
        }
        worker.streamPush(sid, /* isEos */true, /* chunk */null, /* isError */ error != null)
          .then(
            () => {
              callback(null);
            },
            (err: any) => {
              callback(err);
            });
      },
      autoDestroy: true,
    });
    this.#headerCallback = headerCallback;
  }

  flushHeaders() {
    this.writeHead(this.statusCode);
  }

  getHeader(name: string) {
    return this.#headers[name];
  }

  getHeaderNames() {
    return Object.keys(this.#headers);
  }

  getHeaders() {
    return {
      ...this.#headers,
    };
  }

  hasHeader(name: string) {
    return name in this.#headers;
  }

  get headersSent() {
    return this.#headersSent;
  }

  removeHeader(name: string) {
    delete this.#headers[name];
  }

  setHeader(name: string, value: string) {
    this.#headers[name] = value;
  }

  get statusCode() {
    return this.#statusCode;
  }

  set statusCode(val) {
    this.#statusCode = val;
  }

  get statusMessage() {
    return STATUS_CODES[this.#statusCode];
  }

  writeHead(statusCode: number, statusMessage?: string, headers?: Record<string, string>) {
    if (typeof statusMessage !== 'string') {
      headers = statusMessage;
      statusMessage = undefined;
    }
    this.statusCode = statusCode;

    if (Array.isArray(headers)) {
      if (headers.length % 2 !== 0) {
        throw new Error('headers is not valid');
      }

      let key;
      for (let n = 0; n < headers.length; n += 2) {
        key = headers[n + 0];
        if (key) this.setHeader(key, headers[n + 1]);
      }
    } else if (headers) {
      for (const [ key, val ] of Object.entries(headers)) {
        this.setHeader(key, val);
      }
    }

    if (!this.#headersSent) {
      this.#sendHeader();
    }
  }
}
