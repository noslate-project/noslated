import http from 'http';
import https from 'https';
import { Readable, Writable } from 'stream';
import { tryQ } from '../lib/util';
import { TriggerResponse, Metadata, flattenKeyValuePairs } from './request_response';
import { NoslatedStreamError } from './error';
import { DelegateMetricAttributes } from '#self/lib/telemetry/semantic_conventions';
import { Extension }  from './extension';
import { aworker } from '../proto/aworker';
import { keyValuePairsToObject, flattenToKeyValuePairs } from './noslated_ipc';
import { DelegateSharedState } from './delegate_shared_state';
import { CredentialRegistration, WorkerState } from './registration';
import { NoslatedDelegateService } from '.';
import { MetadataInit } from '#self/delegate/request_response';
import { kDefaultRequestId } from '#self/lib/constants';

const logger = require('../lib/logger').get('invoke-controller');

const {
  CanonicalCode,
  ResourcePutAction,
} = aworker.ipc;

const kCancelledCanonicalCode = [ CanonicalCode.CANCELLED, CanonicalCode.CONNECTION_RESET ];

const TriggerMethods = {
  invoke: 'invoke',
  init: 'init',
};

type CommonCallback = (code: aworker.ipc.CanonicalCode, error?: Error | null, data?: { status?: number; sid?: number; headers?: any[]; data?: any; successOrAcquired?: boolean; token?: string; }) => void;

export class InvokeController {
  /**
   * @type {import('./delegate_shared_state').DelegateSharedState}
   */
  #sharedState: DelegateSharedState;

  /**
   * @type {import('./registration').CredentialRegistration}
   */
  #registration: CredentialRegistration;

  /**
   * @type {import('./registration').WorkerState}
   */
  #state: WorkerState;

  /**
   * @type {import('./index')}
   */
  #delegate: NoslatedDelegateService;

  /**
   * @type {import('./extension').Extension}
   */
  #extension: Extension;

  #sessionId;
  constructor(sharedState: DelegateSharedState, registration: CredentialRegistration, delegate: NoslatedDelegateService) {
    this.#sharedState = sharedState;
    this.#registration = registration;
    this.#sessionId = registration.sessionId;
    this.#state = registration.state;
    this.#delegate = delegate;
    this.#extension = new Extension(sharedState.namespaceResolver);
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async StreamOpen(params: aworker.ipc.StreamOpenRequestMessage, callback: CommonCallback) {
    const sid = this.#sharedState.server!.nextStreamId(this.#sessionId);
    this.#makeReadable(sid);
    callback(CanonicalCode.OK, null, {
      sid,
    });
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async StreamPush(params: aworker.ipc.StreamPushRequestMessage, callback: CommonCallback) {
    const { sid, isEos, data, isError } = params;
    const readable = this.#state.getReadable(sid);
    callback(CanonicalCode.OK);
    if (readable == null) {
      return;
    }
    if (isError) {
      readable.destroy(new Error('peer reset stream'));
      this.#state.removeReadable(sid);
      return;
    }
    if (isEos) {
      readable.push(null);
      this.#state.removeReadable(sid);
      return;
    }
    readable.push(data);
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async Fetch(params: aworker.ipc.FetchRequestMessage, callback: CommonCallback) {
    const url = tryQ(() => new URL(params.url));
    if (url == null) {
      callback(CanonicalCode.CLIENT_ERROR);
      return;
    }
    const protocol = url.protocol;
    let mod;
    switch (protocol) {
      case 'http:':
        mod = http;
        break;
      case 'https:':
        mod = https;
        break;
      default:
    }
    const originHeaders = params.headers;
    const headers = keyValuePairsToObject(originHeaders);

    let readable: Readable | undefined = undefined;
    let sid = params.sid;
    const hasBody = sid != null;
    if (hasBody) {
      readable = this.#state.getReadable(sid as number) as Readable;
      if (readable == null) {
        callback(CanonicalCode.CLIENT_ERROR, new Error('Body readable not created'));
        return;
      }
    } else {
      sid = this.#sharedState.server!.nextStreamId(this.#sessionId);
    }

    let headerSent = false;
    const writable = this.#makeWritable(sid as number);
    const req = mod?.request(url, {
      method: params.method,
      headers,
    }, res => {
      const originHeaders = res.rawHeaders.concat([
        'x-anc-remote-address', `${res.socket.remoteAddress}`,
        'x-anc-remote-family', `${res.socket.remoteFamily}`,
        'x-anc-remote-port', `${res.socket.remotePort}`,
      ]);
      const headers = flattenToKeyValuePairs(originHeaders);
      callback(CanonicalCode.OK, null, {
        status: res.statusCode,
        headers,
        sid: sid as number,
      });
      headerSent = true;
      res.pipe(writable);
      res.on('error', e => {
        writable.destroy(e);
        // In case of no-ending incoming stream.
        readable?.destroy();
        if (params.requestId != null) {
          this.#state.fetchRequests.delete(params.requestId);
        }
      });
      // In case of no-ending incoming stream.
      res.on('end', () => {
        if (hasBody) {
          readable?.destroy();
        }
        if (params.requestId != null) {
          this.#state.fetchRequests.delete(params.requestId);
        }
      });
    });
    if (hasBody) {
      readable?.pipe(req as http.ClientRequest);
      readable?.on('error', e => {
        (req as http.ClientRequest).destroy(e);
      });

      (req as http.ClientRequest).flushHeaders();
    } else {
      (req as http.ClientRequest).end();
    }

    if (params.requestId != null) {
      this.#state.fetchRequests.set(params.requestId, req as http.ClientRequest);
    }

    (req as http.ClientRequest).setTimeout(10_000, () => {
      const err = new Error('Socket timeout');
      (req as http.ClientRequest).destroy(err);
      readable?.destroy(err);
      if (headerSent) {
        writable.destroy(err);
        return;
      }
      callback(CanonicalCode.INTERNAL_ERROR, err);
    });
    (req as http.ClientRequest).on('error', e => {
      if (params.requestId != null) {
        this.#state.fetchRequests.delete(params.requestId);
      }
      if (headerSent) {
        writable.destroy(e);
        return;
      }
      callback(CanonicalCode.INTERNAL_ERROR, e);
    });
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async FetchAbort(params: aworker.ipc.FetchAbortRequestMessage, callback: CommonCallback) {
    if (!this.#state.fetchRequests.has(params.requestId)) {
      return callback(CanonicalCode.OK, null);
    }

    const req = this.#state.fetchRequests.get(params.requestId);
    const err = new Error('aborted');
    (req as http.ClientRequest).destroy(err);

    callback(CanonicalCode.OK, null);
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async DaprInvoke(params: aworker.ipc.DaprInvokeRequestMessage, callback: CommonCallback) {
    if (this.#sharedState.daprAdaptor == null) {
      callback(CanonicalCode.NOT_IMPLEMENTED);
      return;
    }
    try {
      const { status, data } = await this.#sharedState.daprAdaptor.invoke({
        appId: params.appId,
        methodName: params.methodName,
        data: params.data,
      });
      callback(CanonicalCode.OK, null, { status, data });
    } catch (e) {
      logger.error('dapr invoke failed', e);
      callback(CanonicalCode.INTERNAL_ERROR, e as Error);
    }
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async DaprBinding(params: aworker.ipc.DaprBindingRequestMessage, callback: CommonCallback) {
    if (this.#sharedState.daprAdaptor == null) {
      callback(CanonicalCode.NOT_IMPLEMENTED);
      return;
    }
    try {
      const { status, data } = await this.#sharedState.daprAdaptor.binding({
        name: params.name,
        metadata: JSON.parse(params.metadata),
        operation: params.operation,
        data: params.data,
      });
      callback(CanonicalCode.OK, null, { status, data });
    } catch (e) {
      logger.error('dapr binding failed', e);
      callback(CanonicalCode.INTERNAL_ERROR, e as Error);
    }
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async ExtensionBinding(params: aworker.ipc.ExtensionBindingRequestMessage, callback: CommonCallback) {
    try {
      const { status, data } = await this.#extension[params.name](this.#registration.credential, params.operation, JSON.parse(params.metadata), params.data);
      callback(CanonicalCode.OK, null, { status, data });
    } catch (e) {
      if (typeof (e as aworker.ipc.IExtensionBindingResponseMessage & Error).status === 'number') {
        return callback(CanonicalCode.OK, null, {
          status: (e as aworker.ipc.IExtensionBindingResponseMessage & Error).status,
          data: Buffer.from((e as aworker.ipc.IExtensionBindingResponseMessage & Error).message),
        });
      }
      logger.error('extension binding failed', e);
      callback(CanonicalCode.INTERNAL_ERROR, e as Error);
    }
  }

  /**
   * Handler
   * @param {*} params -
   * @param {*} callback -
   */
  async ResourcePut(params: aworker.ipc.IResourcePutRequestMessage, callback: CommonCallback) {
    const { action, resourceId, token } = params;
    const resources = this.#sharedState.namespaceResolver.resolve(this.#registration.credential).resources;
    let resourceStub = resources.get(resourceId);
    if (resourceStub == null) {
      resourceStub = this.#delegate.makeResourceStub(resourceId);
      resources.set(resourceId, resourceStub);
      resourceStub.on('end', () => {
        resources.delete(resourceId);
      });
    }
    logger.info('on resource put action(%s) resourceId(%s) with token(%s)', action, resourceId, token);

    if (action !== ResourcePutAction.RELEASE) {
      const { acquired, token } = resourceStub.acquire(action === ResourcePutAction.ACQUIRE_EX, this.#registration.credential);
      this.#state.addResource(token, resourceStub);
      logger.info('resource acquired, resourceId(%s) with token(%s)', resourceId, token);
      callback(CanonicalCode.OK, null, {
        successOrAcquired: acquired,
        token,
      });
      return;
    }

    resourceStub.release(token as string);
    this.#state.removeResource(token as string);
    callback(CanonicalCode.OK, null, { successOrAcquired: true, token: '' });
  }


  /**
   * NoslatedDelegateService#trigger
   * @param {string} method the method
   * @param {Buffer|Readable} data the data
   * @param {Metadata|object} [metadataInit] the metadata
   * @return {TriggerResponse} response
   */
  async trigger(method: string, data: Buffer|Readable|null, metadataInit: MetadataInit | Metadata) {
    const startTime = Date.now();
    if (typeof method !== 'string') {
      throw new TypeError('expect a string of method');
    }
    const hasInputData = data != null;
    const hasOutputData = method !== TriggerMethods.init;

    if (hasInputData && !(data instanceof Readable) && !(data instanceof Buffer)) {
      throw new TypeError(`expect a buffer or readable stream of data, but got ${data[Symbol.toStringTag] || typeof data}`);
    }

    let metadataUrl = '';
    let metadataMethod = '';
    let metadataHeaders: string[] = [];
    let metadataBaggage: string[] = [];
    let timeout = 10_000;
    let requestId = kDefaultRequestId;
    let metadata: Metadata = new Metadata({});

    if (metadataInit) {
      if (!(metadataInit instanceof Metadata)) {
        metadata = new Metadata(metadataInit);
      } else {
        metadata = metadataInit;
      }
    }

    if (metadata) {
      metadataUrl = metadata.url ?? metadataUrl;
      metadataMethod = metadata.method ?? metadataMethod;
      metadataHeaders = flattenKeyValuePairs(metadata.headers ?? []);
      metadataBaggage = flattenKeyValuePairs(metadata.baggage ?? []);
      timeout = metadata.timeout ?? timeout;
      requestId = metadata.requestId;
    }

    let receivedMetadata = false;
    let errorsBeforeMetadata;
    let response;

    const ret = this.#sharedState.server!.trigger(
      this.#sessionId,
      method,
      {
        url: metadataUrl,
        method: metadataMethod,
        headers: metadataHeaders,
        baggage: metadataBaggage,
        requestId,
      },
      hasInputData,
      hasOutputData,
      timeout
    );
    if (hasInputData) {
      const writable = this.#makeWritable(ret.sid as number);
      if (data instanceof Readable) {
        data.on('error', e => {
          if (receivedMetadata) {
            writable.destroy(e);
          } else {
            errorsBeforeMetadata = e;
          }
        });
        data.pipe(writable);
      } else {
        writable.end(data);
      }
      // TODO: how to handle those write errors? align with fetch standards.
      writable.on('error', (e: Error) => {
        logger.error('unexpected error on writing to peer', e);
      });
    }
    if (hasOutputData) {
      response = this.#makeReadable(ret.sid as number, {
        kReadable: TriggerResponse,
      });
    } else {
      response = new TriggerResponse();
      /** immediate end the readable */
      response.push(null);
    }

    let resHead;
    try {
      resHead = await ret.future;
    } catch (e) {
      /** cleanup response readables, ignore any incoming data */
      response.destroy();
      throw e;
    }
    const endTime = Date.now();

    this.#sharedState.triggerCounter!.add(1, {
      [DelegateMetricAttributes.TRIGGER_METHOD]: method,
    });
    this.#sharedState.triggerDurationRecorder!.record(endTime - startTime, {
      [DelegateMetricAttributes.TRIGGER_METHOD]: method,
    });

    receivedMetadata = true;
    if (errorsBeforeMetadata) {
      throw errorsBeforeMetadata;
    }
    response.status = resHead.status;
    response.metadata = new Metadata(resHead.metadata as unknown as MetadataInit);
    return response;
  }

  /**
   * Create a Readable from streamId
   * @param {number} sid -
   * @param {{ kReadable: Function }} options -
   * @return {Readable} readable constructed from kReadable.
   */
  #makeReadable(sid: number, options: { kReadable?: any } = {}) {
    let { kReadable } = options;

    if (kReadable == null) {
      kReadable = Readable;
    }

    const readable = new kReadable({
      read() {},
      destroy: (e: Error, cb: (error?: Error | null) => void) => {
        logger.debug('stream readable destroying, error?', e);
        this.#state.removeReadable(sid);
        cb(e);
      },
    });

    this.#state.addReadable(sid, readable);
    return readable;
  }

  /**
   * Create a Writable from streamId
   * @param {number} sid -
   * @param {{ kWritable: Function }} options -
   * @return {Writable} readable constructed from kWritable.
   */
  #makeWritable(sid: number, options: { kWritable?: any } = {}) {
    let { kWritable } = options;
    if (kWritable == null) {
      kWritable = Writable;
    }
    const writable = new kWritable({
      write: (chunk: Buffer, encoding: string, cb: (error?: Error | null) => void) => {
        // TODO: encoding
        if (encoding !== 'buffer') {
          return cb(new TypeError('expect buffer encoding on writable'));
        }
        logger.debug('stream writable write chunk to peer', chunk.byteLength);
        this.#streamPush(sid, chunk)
          .then(
            () => cb(),
            e => {
              cb(e);
              this.#closeStream(sid, /* isError */true);
            }
          );
      },
      destroy: (e: Error, cb: (error?: Error | null) => void) => {
        logger.debug('stream writable write end, error?', e);
        this.#state.removeWritable(writable);
        if (e instanceof NoslatedStreamError && e.name === 'PEER_CONNECTION_CLOSED') {
          return cb();
        }
        this.#closeStream(sid, /* isError */e !== undefined && e !== null)
          .then(() => cb());
      },
    });

    this.#state.addWritable(writable);
    return writable;
  }

  #streamPush = (sid: number, chunk: Buffer) => {
    if (this.#sharedState.server == null) {
      return Promise.reject(new Error('Server closed'));
    }
    return this.#sharedState.server.streamPush(this.#sessionId, sid, /* isEos */false, /* chunk */chunk, /* isError */false);
  }

  #closeStream = async (sid: number, isError: boolean) => {
    if (this.#sharedState.server == null) {
      return;
    }
    return this.#sharedState.server.streamPush(this.#sessionId, sid, /* isEos */true, /* chunk */null, /* isError */isError)
      .catch(e => {
        if (kCancelledCanonicalCode.includes(e.code)) {
          return;
        }
        if (this.#registration.closed) {
          logger.debug('closing stream but session already closed', this.#registration.credential);
          return;
        }
        logger.error('unexpected error on closing stream', e, this.#registration.credential);
      });
  }
}
