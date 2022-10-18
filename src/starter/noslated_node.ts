import { NoslatedClient, CanonicalCode } from './util';
import starter, { OnInit, OnRequest } from './base_node';
import { makeDapr } from './dapr';
import { NaiveLogger, safeError } from './util';
import { IncomingMessage, MetadataInit, ServerResponse } from './request_response';
import { aworker } from '#self/proto/aworker';
import v8 from 'v8';
import { TextDecoder, TextEncoder } from 'util';

// Keep a reference to primordial process exit.
const processExit = process.exit.bind(process);

export class NoslatedNodeWorker {
  #client;
  #readableMap = new Map();
  #onInit;
  #baseRequest;
  #logger;
  #encoder = new TextEncoder();
  #decoder = new TextDecoder();
  constructor(serverPath: string, credential: string, onInit: OnInit, onRequest: OnRequest, logger: NaiveLogger) {
    this.#client = new NoslatedClient(serverPath, credential, logger);
    this.#onInit = onInit;
    this.#baseRequest = onRequest;
    this.#client.onRequest = this.#onRequest;
    this.#client.onCollectMetrics = this.#onCollectMetrics;
    this.#client.onStreamPush = this.#onStreamPush;
    this.#client.onDisconnect = this.#onDisconnect;
    this.#logger = logger;
  }

  #onRequest: NoslatedClient['onRequest'] = (method, sid, metadata, hasInputData, hasOutputData, callback) => {
    this.#logger.debug('on request: method(%s), sid(%s, input %s, output %s), metadata(%o)', method, sid, hasInputData, hasOutputData, metadata);
    if (method === 'init') {
      const ctx = this.#makeContext();
      Promise.resolve(this.#onInit(ctx))
        .then(
          () => callback(CanonicalCode.OK, null, { status: 200, metadata: {} } as aworker.ipc.ITriggerResponseMessage),
          e => {
            this.#logger.error('unexpected error on init', e);
            callback(CanonicalCode.INTERNAL_ERROR, safeError(e));
          }
        );
      return;
    }
    if (method === 'invoke') {
      if (sid == null) {
        return callback(CanonicalCode.CLIENT_ERROR, { message: 'Invoke requires data' });
      }
      const ctx = this.#makeContext();
      const req = new IncomingMessage(metadata as unknown as MetadataInit);
      const res = new ServerResponse(this, hasOutputData ? sid : null, callback);
      if (hasInputData) {
        this.#readableMap.set(sid, req);
      } else {
        req.push(null);
      }
      Promise.resolve(this.#baseRequest(ctx, req, res))
        .then(
          () => {},
          e => {
            this.#logger.error('unexpected error on handler', e);
            res.destroy(e);
          }
        );
      return;
    }
    callback(CanonicalCode.NOT_IMPLEMENTED);
  };

  #onStreamPush: NoslatedClient['onStreamPush'] = (streamId, isEos, chunk, isError) => {
    this.#logger.debug('on stream push: id(%s), isEos(%s), isError(%s)', streamId, isEos, isError);
    const readable = this.#readableMap.get(streamId);
    if (readable == null) {
      return;
    }
    if (isError) {
      readable.destroy(new Error('Peer reset steam'));
      this.#readableMap.delete(streamId);
      return;
    }
    if (isEos) {
      readable.push(null);
      this.#readableMap.delete(streamId);
      return;
    }
    readable.push(chunk);
  };

  #onCollectMetrics: NoslatedClient['onCollectMetrics'] = () => {
    const heapStatistics = v8.getHeapStatistics();

    const labels = [
      {
        key: 'noslate.worker.pid',
        value: `${process.pid}`,
      },
    ];
    return {
      integerRecords: Object.entries(heapStatistics).map(([key, value]) => {
        return {
          name: `noslate.worker.${key}`,
          value,
          labels,
        };
      }),
    };
  }

  #onDisconnect = () => {
    console.error('starter client disconnected');
    processExit(1);
  };

  #makeContext = () => {
    const context = {
      Dapr: makeDapr(this.#client),
      sendBeacon: this.#sendBeacon.bind(this),
    };
    return context;
  }

  #sendBeacon(type: string, options: { format?: string }, data: ArrayBuffer | string | Uint8Array | Uint16Array | Uint32Array) {
    if (typeof type !== 'string') {
      throw TypeError('type must be a string');
    }

    const format = options.format;

    if (format != null && typeof format !== 'string') {
      throw TypeError('options.format must be a string');
    }

    if(typeof data === 'string') {
      data = this.#encoder.encode(data);
    }

    this.#client.extensionBinding('beacon',
      JSON.stringify({ type, format }),
      'send',
      Buffer.from(data),
      ).then(({ status, data }) => {
        if(status !== 200) {
          const message = this.#decoder.decode(data);
          this.#logger.error(`Failed to send beacon: status(${status}) ${message}`);
        }
      }).catch(e => {
        this.#logger.error(e);
      })

      return true;
  }

  streamPush(sid: number, isEos: boolean, chunk: Uint8Array | null, isError: boolean) {
    this.#logger.debug('stream push: id(%s), isEos(%s), isError(%s)', sid, isEos, isError);
    return this.#client.streamPush(sid, isEos, chunk, isError);
  }

  start() {
    return this.#client.start();
  }
}

starter(({ serverPath, credential, onInit, onRequest, logger = new NaiveLogger() }) => {
  const client = new NoslatedNodeWorker(serverPath, credential, onInit, onRequest, logger);
  client.start();
});
