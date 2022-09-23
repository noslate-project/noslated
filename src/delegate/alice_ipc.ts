import net, { Socket } from 'net';
import fs from 'fs';
import { castError, createDeferred, Deferred, raceEvent } from '../lib/util';
import { aworker } from '../proto/aworker';

export type CanonicalCode = aworker.ipc.CanonicalCode;
export const CanonicalCode = aworker.ipc.CanonicalCode;

const kShouldVerifyProtocol = process.env.ALICE_INTERCEPTOR_VERIFY === 'true';

type RequestKind = aworker.ipc.RequestKind;
const RequestKind = aworker.ipc.RequestKind;

type MessageKind = aworker.ipc.MessageKind;
const MessageKind = aworker.ipc.MessageKind;

const ALICE_CONNECT_TIMEOUT_MS = 5000;
const ALICE_STREAM_PUSH_TIMEOUT_MS = 30000;
const ALICE_RESOURCE_NOTIFICATION_TIMEOUT_MS = 2000;
const ALICE_COLLECT_METRICS_TIMEOUT_MS = 2000;
const ALICE_INSPECTOR_TIMEOUT_MS = 60000;
const ALICE_DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const ALICE_SEND_BEACON_TIMEOUT_MS = 10_000;

const kRequestKindDataMap: { [key: number]: [any, any] } = {
  [RequestKind.Trigger]: [aworker.ipc.TriggerRequestMessage, aworker.ipc.TriggerResponseMessage],
  [RequestKind.StreamPush]: [aworker.ipc.StreamPushRequestMessage, aworker.ipc.StreamPushResponseMessage],
  [RequestKind.StreamOpen]: [aworker.ipc.StreamOpenRequestMessage, aworker.ipc.StreamOpenResponseMessage],
  [RequestKind.CollectMetrics]: [aworker.ipc.CollectMetricsRequestMessage, aworker.ipc.CollectMetricsResponseMessage],
  [RequestKind.Credentials]: [aworker.ipc.CredentialsRequestMessage, aworker.ipc.CredentialsResponseMessage],
  [RequestKind.Fetch]: [aworker.ipc.FetchRequestMessage, aworker.ipc.FetchResponseMessage],
  [RequestKind.DaprInvoke]: [aworker.ipc.DaprInvokeRequestMessage, aworker.ipc.DaprInvokeResponseMessage],
  [RequestKind.DaprBinding]: [aworker.ipc.DaprBindingRequestMessage, aworker.ipc.DaprBindingResponseMessage],
  [RequestKind.FetchAbort]: [aworker.ipc.FetchAbortRequestMessage, aworker.ipc.FetchAbortResponseMessage],
  [RequestKind.ExtensionBinding]: [aworker.ipc.ExtensionBindingRequestMessage, aworker.ipc.ExtensionBindingResponseMessage],
  [RequestKind.ResourceNotification]: [aworker.ipc.ResourceNotificationRequestMessage, aworker.ipc.ResourceNotificationResponseMessage],
  [RequestKind.ResourcePut]: [aworker.ipc.ResourcePutRequestMessage, aworker.ipc.ResourcePutResponseMessage],
  [RequestKind.InspectorStart]: [aworker.ipc.InspectorStartRequestMessage, aworker.ipc.InspectorStartResponseMessage],
  [RequestKind.InspectorStartSession]: [aworker.ipc.InspectorStartSessionRequestMessage, aworker.ipc.InspectorStartSessionResponseMessage],
  [RequestKind.InspectorEndSession]: [aworker.ipc.InspectorEndSessionRequestMessage, aworker.ipc.InspectorEndSessionResponseMessage],
  [RequestKind.InspectorGetTargets]: [aworker.ipc.InspectorGetTargetsRequestMessage, aworker.ipc.InspectorGetTargetsResponseMessage],
  [RequestKind.InspectorCommand]: [aworker.ipc.InspectorCommandRequestMessage, aworker.ipc.InspectorCommandResponseMessage],
  [RequestKind.InspectorEvent]: [aworker.ipc.InspectorEventRequestMessage, aworker.ipc.InspectorEventResponseMessage],
  [RequestKind.InspectorStarted]: [aworker.ipc.InspectorStartedRequestMessage, aworker.ipc.InspectorStartedResponseMessage],
  [RequestKind.TracingStart]: [aworker.ipc.TracingStartRequestMessage, aworker.ipc.TracingStartResponseMessage],
  [RequestKind.TracingStop]: [aworker.ipc.TracingStopRequestMessage, aworker.ipc.TracingStopResponseMessage],
};

export class AliceError extends Error {
  peerStack?: string;
  operation: string;
  constructor(public code: CanonicalCode, public kind: RequestKind, message: string = '') {
    super(`Alice request failed: CanonicalCode::${CanonicalCode[code]} request kind(${RequestKind[kind]}), ${message}`);
    this.name = 'AliceError';
    this.operation = RequestKind[kind];
  }
}

export interface Logger {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const kNoopLogger = {
  debug: () => {},
  error: console.error,
};

export class AliceServer {
  private _nextSessionId = new IdGenerator();
  private _server: net.Server;
  private _sessions: Map<number, Session> = new Map();
  onRequest?: (sessionId: number, op: string, params: unknown, callback: any) => void;
  onDisconnect?: (sessionId: number) => void;

  constructor(private _serverPath: string, private _logger: Logger = kNoopLogger) {
    this._server = net.createServer(this._onConnection);
  }

  public async start() {
    try {
      fs.unlinkSync(this._serverPath);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e;
      }
    }
    this._server.listen(this._serverPath);
    const [ event, err ] = await raceEvent(this._server, ['listening', 'error']);
    if (event === 'error') {
      throw err;
    }

    // Install error event after listening.
    this._server.on('error', this._onError);
  }

  close() {
    return new Promise<void>((resolve, reject) => {
      this._server.close((err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    })
  }

  nextStreamId(sessionId: number) {
    const session = this._sessions.get(sessionId);
    if (session == null) {
      return -1;
    }
    return session.nextStreamId.next();
  }

  trigger(sessionId: number, method: string, metadata: MetadataToIPC, hasInputData: boolean, hasOutputData: boolean, timeout: number) {
    const kind = RequestKind.Trigger;
    const session = this._getSession(sessionId, kind);
    let sid: number | undefined;
    if (hasInputData || hasOutputData) {
      sid = session.nextStreamId.next()
    }
    const future = session.request<
      aworker.ipc.ITriggerRequestMessage,
      aworker.ipc.ITriggerResponseMessage
    >(kind, {
      method,
      metadata: {
        url: metadata.url,
        method: metadata.method,
        headers: flattenToKeyValuePairs(metadata.headers ?? []),
        baggage: flattenToKeyValuePairs(metadata.baggage ?? []),
        requestId: metadata.requestId
      },
      hasInputData,
      hasOutputData,
      sid,
    }, timeout)
      .then(res => {
        return {
          status: res.status,
          metadata: {
            headers: keyValuePairsToArray(res.metadata.headers ?? []),
          },
        };
      });

    return {
      sid,
      future
    }
  }

  async streamPush(sessionId: number, sid: number, isEos: boolean, data: Uint8Array | null, isError: boolean) {
    const kind = RequestKind.StreamPush;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IStreamPushRequestMessage,
      aworker.ipc.IStreamPushResponseMessage
    >(kind, {
      sid,
      isEos,
      isError,
      data,
    }, ALICE_STREAM_PUSH_TIMEOUT_MS);
  }

  async collectMetrics(sessionId: number) {
    const kind = RequestKind.CollectMetrics;
    const session = this._getSession(sessionId, kind);
    const result = await session.request<
      aworker.ipc.ICollectMetricsRequestMessage,
      aworker.ipc.ICollectMetricsResponseMessage
    >(kind, {}, ALICE_COLLECT_METRICS_TIMEOUT_MS);

    return {
      integerRecords: result.integerRecords?.map(it => {
        return {
          labels: keyValuePairsToObject(it.labels ?? []),
          name: it.name,
          value: it.value,
        }
      })
    }
  }

  async resourceNotification(sessionId: number, resourceId: string, token: string) {
    const kind = RequestKind.ResourceNotification;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IResourceNotificationRequestMessage,
      aworker.ipc.IResourceNotificationResponseMessage
    >(kind, {
      resourceId,
      token,
    }, ALICE_RESOURCE_NOTIFICATION_TIMEOUT_MS);
  }

  async inspectorStart(sessionId: number) {
    const kind = RequestKind.InspectorStart;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IInspectorStartRequestMessage,
      aworker.ipc.IInspectorStartResponseMessage
    >(kind, {}, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  async inspectorStartSession(sessionId: number, inspectorSessionId: number, targetId: string) {
    const kind = RequestKind.InspectorStartSession;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IInspectorStartSessionRequestMessage,
      aworker.ipc.IInspectorStartSessionResponseMessage
    >(kind, {
      sessionId: inspectorSessionId,
      targetId,
    }, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  async inspectorEndSession(sessionId: number, inspectorSessionId: number) {
    const kind = RequestKind.InspectorEndSession;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IInspectorEndSessionRequestMessage,
      aworker.ipc.IInspectorEndSessionResponseMessage
    >(kind, {
      sessionId: inspectorSessionId,
    }, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  async inspectorGetTargets(sessionId: number) {
    const kind = RequestKind.InspectorGetTargets;
    const session = this._getSession(sessionId, kind);
    const result = await session.request<
      aworker.ipc.IInspectorGetTargetsRequestMessage,
      aworker.ipc.IInspectorGetTargetsResponseMessage
    >(kind, {}, ALICE_INSPECTOR_TIMEOUT_MS);

    return result.targets ?? [];
  }

  async inspectorCommand(sessionId: number, inspectorSessionId: number, message: string) {
    const kind = RequestKind.InspectorCommand;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.IInspectorCommandRequestMessage,
      aworker.ipc.IInspectorCommandResponseMessage
    >(kind, {
      sessionId: inspectorSessionId,
      message: message,
    }, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  async tracingStart(sessionId: number, categories: string[]) {
    const kind = RequestKind.TracingStart;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.ITracingStartRequestMessage,
      aworker.ipc.ITracingStartResponseMessage
    >(kind, {
      categories,
    }, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  async tracingStop(sessionId: number) {
    const kind = RequestKind.TracingStop;
    const session = this._getSession(sessionId, kind);
    return session.request<
      aworker.ipc.ITracingStopRequestMessage,
      aworker.ipc.ITracingStopResponseMessage
    >(kind, {}, ALICE_INSPECTOR_TIMEOUT_MS);
  }

  terminateSession(sessionId: number) {
    this._closeSession(sessionId, new AliceError(CanonicalCode.CANCELLED, aworker.ipc.RequestKind.Nil, 'Session terminated'));
  }

  unref() {
    this._server.unref();
  }

  ref() {
    this._server.ref();
  }

  private _onConnection = (socket: net.Socket) => {
    const sid = this._nextSessionId.next();
    const session = new Session(sid, socket, this._onRequest, this._onDisconnect, this._onError, this._logger);
    this._sessions.set(sid, session);
  }

  private _onDisconnect = (session: Session) => {
    this._sessions.delete(session.sid);
    this.onDisconnect?.(session.sid);
  }

  private _onError = (error: Error, session?: Session) => {
    if (session) {
      this._logger.error('unexpected error on session(%s)', session?.sid, error);
      this._closeSession(session.sid, error);
    } else {
      // unrecoverable error.
      this._logger.error('unexpected socket error', error);
      throw error;
    }
  }

  private _closeSession(sessionId: number, error?: Error) {
    const session = this._sessions.get(sessionId);
    if (session == null) {
      return;
    }
    this._sessions.delete(sessionId);
    session.destroy(error);
  }

  private _getSession(sessionId: number, kind: RequestKind) {
    const session = this._sessions.get(sessionId);
    if (session == null) {
      throw new AliceError(CanonicalCode.CONNECTION_RESET, kind, 'session not connected');
    }
    return session;
  }

  private _onRequest = (session: Session, message: Message, callback: any) => {
    if (this.onRequest == null) {
      return callback(CanonicalCode.NOT_IMPLEMENTED);
    }
    this.onRequest(session.sid, RequestKind[message.requestKind], message.content, callback);
  }
}

export class AliceClient {
  private _socket?: net.Socket;
  private _session?: Session;
  onRequest?: (method: string, streamId: number | undefined | null, metadata: aworker.ipc.ITriggerMetadata, hasInputData: boolean, hasOutputData: boolean, callback: any) => void;
  onStreamPush?: (streamId: number, isEos: boolean, chunk: Uint8Array, isError: boolean) => void;
  onCollectMetrics?: () => aworker.ipc.ICollectMetricsResponseMessage;
  onDisconnect?: () => void;

  constructor(private _serverPath: string, private _credential: string, private _logger: Logger = kNoopLogger) {}

  public async start() {
    const socket = net.connect(this._serverPath);
    this._socket = socket;
    const [ event ] = await raceEvent(socket, ['connect', 'error']);
    if (event !== 'connect') {
      throw new Error(`Failed to connect: ${event}`)
    }
    this._session = new Session(0, socket, this._onRequest, this._onClose, this._onError, this._logger);
    try {
      await this._session.request<
        aworker.ipc.ICredentialsRequestMessage,
        aworker.ipc.ICredentialsResponseMessage
      >(RequestKind.Credentials, {
        type: aworker.ipc.CredentialTargetType.Data,
        cred: this._credential,
      }, ALICE_CONNECT_TIMEOUT_MS);
    } catch (e) {
      this._session.destroy();
      throw e;
    }
  }

  close() {
    this._session?.destroy(new AliceError(CanonicalCode.CANCELLED, aworker.ipc.RequestKind.Nil, 'Session terminated'));
  }

  streamPush(streamId: number, isEos: boolean, data: Uint8Array | null, isError: boolean) {
    if (this._session == null) {
      throw new Error('Alice client not connected');
    }
    return this._session.request<
      aworker.ipc.IStreamPushRequestMessage,
      aworker.ipc.IStreamPushResponseMessage
    >(RequestKind.StreamPush, {
      sid: streamId,
      isEos,
      isError,
      data,
    }, ALICE_STREAM_PUSH_TIMEOUT_MS);
  }

  daprInvoke(appId: string, methodName: string, data: Uint8Array, timeout: number) {
    if (this._session == null) {
      throw new Error('Alice client not connected');
    }
    return this._session.request<
      aworker.ipc.IDaprInvokeRequestMessage,
      aworker.ipc.IDaprInvokeResponseMessage
    >(RequestKind.DaprInvoke, {
      appId,
      methodName,
      data,
    }, timeout);
  }

  daprBinding(name: string, metadata: string, operation: string, data: Uint8Array, timeout: number) {
    if (this._session == null) {
      throw new Error('Alice client not connected');
    }
    return this._session.request<
      aworker.ipc.IDaprBindingRequestMessage,
      aworker.ipc.IDaprBindingResponseMessage
    >(RequestKind.DaprBinding, {
      name,
      metadata,
      operation,
      data,
    }, timeout);
  }


  extensionBinding(name: string, metadata: string, operation: string, data: Uint8Array | null) {
    if (this._session == null) {
      throw new Error('Alice client not connected');
    }

    return this._session.request<
      aworker.ipc.IExtensionBindingRequestMessage,
      aworker.ipc.IExtensionBindingResponseMessage
    >(RequestKind.ExtensionBinding, {
      name,
      metadata,
      operation,
      data
    }, ALICE_SEND_BEACON_TIMEOUT_MS);
  }

  private _onClose = () => {
    this.onDisconnect?.();
  }

  private _onError = (error: Error) => {
    // TODO:
    console.error(error);
    this._session?.destroy(error);
  }

  private _onRequest = (session: Session, message: Message, callback: any) => {
    if (message.requestKind === RequestKind.Trigger) {
      if (this.onRequest == null) {
        return callback(CanonicalCode.NOT_IMPLEMENTED);
      }
      const body = message.content as aworker.ipc.ITriggerRequestMessage;
      this.onRequest(body.method, body.sid, body.metadata, body.hasInputData === true, body.hasOutputData === true, callback);
      return;
    }
    if (message.requestKind === RequestKind.StreamPush) {
      if (this.onStreamPush == null) {
        return callback(CanonicalCode.NOT_IMPLEMENTED);
      }
      const body = message.content as aworker.ipc.IStreamPushRequestMessage;
      this.onStreamPush(body.sid, body.isEos, body.data ?? Buffer.alloc(0), body.isError === true);
      return callback(CanonicalCode.OK, {});
    }
    if (message.requestKind === RequestKind.CollectMetrics) {
      if (this.onCollectMetrics == null) {
        return callback(CanonicalCode.NOT_IMPLEMENTED);
      }
      callback(CanonicalCode.OK, null, this.onCollectMetrics());
      return;
    }
    return callback(CanonicalCode.NOT_IMPLEMENTED);
  }
}

interface RequestRecord {
  kind: RequestKind;
  deferred: Deferred<any>;
  timer: NodeJS.Timeout;
}

class Session {
  private _nextRequestId = new IdGenerator();
  nextStreamId = new IdGenerator();
  private _parser = new MessageParser();
  private _requestMap = new Map<number, RequestRecord>();
  private _interceptor: ProtocolInterceptor;
  private _socketError?: Error;

  constructor(
    public sid: number,
    public _socket: net.Socket,
    private _request: (sess: Session, message: Message, callback: any) => void,
    private _close: (sess: Session) => void,
    private _error: (error: Error, sess: Session) => void,
    private _logger: Logger,
  ) {
    this._socket.on('error', (e) => {
      this._socketError = e;
    });
    this._socket.on('close', this._onClose);
    this._interceptor = new ProtocolInterceptor(this._socket, kShouldVerifyProtocol, this._onData);
  }

  request<T, R>(kind: RequestKind, body: T, timeoutMs: number = ALICE_DEFAULT_REQUEST_TIMEOUT_MS): Promise<R> {
    const messageType = kRequestKindDataMap[kind][0];
    const requestId = this._nextRequestId.next();
    this._logger.debug('request: session(%s) kind(%s), id(%s)', this.sid, kind, requestId);
    const content = messageType.encode(body).finish();
    this._writeRequest(kind, requestId, content);
    const deferred = createDeferred<R>();
    const timer = setTimeout(() => {
      deferred.reject(new AliceError(CanonicalCode.TIMEOUT, kind, 'Request Timeout'));
    }, timeoutMs);
    this._requestMap.set(requestId, {
      kind,
      deferred,
      timer,
    });

    return deferred.promise;
  }

  destroy(err?: Error) {
    this._socket.destroy(err);
  }

  private _writeResponse(kind: RequestKind, requestId: number, code: CanonicalCode, content: Uint8Array) {
    const header: aworker.ipc.IMessageHeader = {
      code,
      contentLength: content.byteLength,
      messageKind: MessageKind.Response,
      requestId,
      requestKind: kind,
    };
    const headerBuffer = aworker.ipc.MessageHeader.encode(header).finish();
    this._interceptor.write(headerBuffer, content);
  }

  private _writeRequest(kind: RequestKind, requestId: number, content: Uint8Array) {
    const header: aworker.ipc.IMessageHeader = {
      code: CanonicalCode.OK,
      contentLength: content.byteLength,
      messageKind: MessageKind.Request,
      requestId: requestId,
      requestKind: kind,
    };
    const headerBuffer = aworker.ipc.MessageHeader.encode(header).finish();
    this._interceptor.write(headerBuffer, content);
  }

  private _onData = (buf: Buffer) => {
    this._parser.push(buf);
    while (true) {
      let maybeMessage: Message | undefined;
      try {
        maybeMessage = this._parser.next();
      } catch (e) {
        this._error(castError(e), this);
        break;
      }
      if (maybeMessage == null) {
        break;
      }
      if (maybeMessage.kind === MessageKind.Request) {
        setImmediate(() => {
          this._onRequest(maybeMessage!);
        });
      } else {
        setImmediate(() => {
          this._onResponse(maybeMessage!);
        });
      }
    }
  }

  private _onRequest = (message: Message) => {
    this._logger.debug('on request: session(%s), kind(%s), id(%s)', this.sid, message.requestKind, message.requestId);
    this._request(this, message, (code: CanonicalCode = CanonicalCode.INTERNAL_ERROR, error: any, body: any) => {
      this._logger.debug('on request handled: session(%s), kind(%s), id(%s), code(%s)', this.sid, message.requestKind, message.requestId, code);
      let content;
      if (code === CanonicalCode.OK) {
        const messageType = kRequestKindDataMap[message.requestKind][1];
        content = messageType.encode(body).finish();
      } else {
        this._logger.debug('error', error ?? new Error().stack);
        content = aworker.ipc.ErrorResponseMessage.encode(error ?? { message: 'Internal Error' }).finish();
      }
      this._writeResponse(message.requestKind, message.requestId, code, content);
    });
  }

  private _onResponse = (message: Message) => {
    this._logger.debug('on response: session(%s), kind(%s), id(%s), code', this.sid, message.requestKind, message.requestId, message.code);
    const record = this._requestMap.get(message.requestId);
    if (record == null) {
      return;
    }
    this._requestMap.delete(message.requestId);
    clearTimeout(record.timer);
    if (message.code === CanonicalCode.OK) {
      record.deferred.resolve(message.content);
    } else {
      const errorResp: aworker.ipc.IErrorResponseMessage = message.content;
      const error = new AliceError(message.code, message.requestKind, errorResp.message ?? 'Request failed');
      error.peerStack = errorResp.stack ?? error.stack;
      record.deferred.reject(error);
    }
  }

  private _onClose = () => {
    for (const record of this._requestMap.values()) {
      clearTimeout(record.timer);
      let error = this._socketError;
      if (error == null) {
        /**
         * If the session is closed without any error, it must be closed on the other side.
         */
        error = new AliceError(CanonicalCode.CONNECTION_RESET, record.kind, 'Session closed')
      }
      record.deferred.reject(error);
    }
    this._requestMap.clear();
    this._close(this);
  }
}

interface Message {
  kind: MessageKind;
  requestId: number;
  requestKind: RequestKind;
  code: CanonicalCode;
  content: any;
}

const kMessageHeaderByteLength = 25;
export class MessageParser {
  private _bufs: Buffer[] = [];
  private _byteLength = 0;
  private _header: aworker.ipc.MessageHeader | null = null;

  push(buf: Buffer) {
    this._bufs.push(buf);
    this._byteLength += buf.byteLength;
  }

  next(): Message | undefined {
    let buf;
    if (this._header == null && this._byteLength >= kMessageHeaderByteLength) {
      buf = this._read(kMessageHeaderByteLength);
      const header = aworker.ipc.MessageHeader.decode(buf, kMessageHeaderByteLength);
      this._header = header;
    }
    if (this._header && this._byteLength >= this._header.contentLength) {
      const header = this._header;
      buf = this._read(header.contentLength);
      const messageType = this._getMessageType(header.messageKind, header.requestKind, header.code);
      const content = messageType.decode(buf, header.contentLength);
      this._header = null;
      return {
        kind: header.messageKind,
        requestId: header.requestId,
        requestKind: header.requestKind,
        code: header.code,
        content,
      };
    }
  }

  private _getMessageType(messageKind: MessageKind, requestKind: RequestKind, code: CanonicalCode) {
    if (messageKind === MessageKind.Response && code !== CanonicalCode.OK) {
      return aworker.ipc.ErrorResponseMessage;
    }
    return kRequestKindDataMap[requestKind][messageKind === MessageKind.Request ? 0 : 1];
  }

  private _read(byteLength: number): Uint8Array {
    if (byteLength === 0) {
      return Buffer.alloc(0);
    }
    let res = this._bufs.shift()!;
    if (res.byteLength < byteLength) {
      let pendingBufs = [res];
      let totalByteLength = res.byteLength
      for (; totalByteLength < byteLength;) {
        const next = this._bufs.shift()!;
        pendingBufs.push(next);
        totalByteLength += next.byteLength;
      }
      res = Buffer.concat(pendingBufs, totalByteLength);
    }
    if (res.byteLength > byteLength) {
      let view = Buffer.from(res.buffer, res.byteOffset, byteLength);
      let unconsumed = Buffer.from(res.buffer, res.byteOffset + byteLength, res.byteLength - byteLength);
      this._bufs.unshift(unconsumed);
      res = view;
    }

    this._byteLength -= res.byteLength;
    return res;
  }
}

class IdGenerator {
  private _nextId = 0;
  next() {
    if (this._nextId === Number.MAX_SAFE_INTEGER) {
      this._nextId = 0;
    }
    return this._nextId++;
  }
}

export function keyValuePairsToObject(keyValuePairs: aworker.ipc.IKeyValuePair[]): Record<string, string> {
  const obj = Object.create(null);
  keyValuePairs.forEach(kv => {
    obj[kv.key] = kv.value;
  });
  return obj;
}

function keyValuePairsToArray(keyValuePairs: aworker.ipc.IKeyValuePair[]): [string, string][] {
  const res: [string, string][] = [];
  keyValuePairs.forEach(it => {
    res.push([it.key, it.value]);
  });
  return res;
}

export function flattenToKeyValuePairs(arr: string[]) {
  const res: aworker.ipc.IKeyValuePair[] = [];
  for (let idx = 0; idx < arr.length; idx += 2) {
    res.push({
      key: arr[idx],
      value: arr[idx + 1],
    });
  }
  return res;
}

export class ProtocolInterceptor {
  private _parser = new MessageParser();

  constructor(private _socket: Socket, private _shouldVerify: boolean, private _onData:  (chunk: Buffer) => void) {
    if (this._shouldVerify) {
      this._socket.on('data', this._interceptOnData);
    } else {
      this._socket.on('data', this._onData);
    }
  }

  write(headerBuffer: Uint8Array, contentBuffer: Uint8Array) {
    if (this._shouldVerify) {
      this._verify(headerBuffer, contentBuffer);
    }
    this._socket.write(headerBuffer);
    this._socket.write(contentBuffer);
  }

  private _interceptOnData = (chunk: Buffer) => {
    // TODO(chengzhong.wcz): how to verify received data?
    this._onData(chunk);
  }

  private _verify(headerBuffer: Uint8Array, contentBuffer: Uint8Array) {
    const totalLength = headerBuffer.byteLength + contentBuffer.byteLength;
    const buf = Buffer.concat([headerBuffer, contentBuffer], totalLength);
    this._parser.push(buf);
    let maybeMessage: Message | undefined;
    try {
      maybeMessage = this._parser.next();
    } catch (e) {
      const err = new Error('verification failed');
      err.cause = e;
      throw err;
    }
    if (maybeMessage == null) {
      throw new Error('written message is not complete');
    }
    if (this._parser['_bufs'].length > 0) {
      throw new Error('written message is overflown');
    }
  }
}

export interface MetadataToIPC {
  url?: string;
  method?: string;
  // key,value,key,value....
  // 兼容 native 版本处理逻辑
  headers?: string[];
  baggage?: string[];
  timeout?: number;
  requestId?: string;
}
