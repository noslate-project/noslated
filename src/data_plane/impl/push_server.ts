import loggers from '#self/lib/logger';
import { RequestLogger } from '../request_logger';
import { createDeferred } from '#self/lib/util';
import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { tuplesToPairs, pairsToTuples } from '#self/lib/rpc/key_value_pair';
import { DataFlowController } from '../data_flow_controller';
import { Config } from '#self/config';
import { Logger } from '#self/lib/loggers';
import { ServerDuplexStream } from '@grpc/grpc-js';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';
import { Readable } from 'stream';
import { IPushServer } from '#self/lib/interfaces/push_server';

interface InvokeRequest extends Readable {
  /** InvokeRequest name */
  name: string;
  /** InvokeRequest url */
  url: string;
  /** InvokeRequest method */
  method: string;
  /** InvokeRequest headers */
  headers: root.noslated.IKeyValuePair[];
  /** InvokeRequest baggage */
  baggage: root.noslated.IKeyValuePair[];
  /** InvokeRequest timeout */
  timeout: number;
  /** InvokeRequest requestId */
  requestId: string;
}

interface PipeResult {
  bytesSent: number;
  status: number;
  error?: unknown;
}

export class PushServerImpl implements IPushServer {
  logger: Logger;
  requestLogger: RequestLogger;

  constructor(
    public dataFlowController: DataFlowController,
    public config: Config
  ) {
    this.logger = loggers.get('push server');
    this.requestLogger = new RequestLogger();
  }

  async #invoke(
    type: string,
    req: InvokeRequest,
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ) {
    const start = Date.now();
    const metadata = new Metadata({
      url: req.url,
      method: req.method,
      headers: pairsToTuples(
        (req.headers as NotNullableInterface<root.noslated.IKeyValuePair>[]) ??
          []
      ),
      baggage: pairsToTuples(
        (req.baggage as NotNullableInterface<root.noslated.IKeyValuePair>[]) ??
          []
      ),
      // TODO: negotiate with deadline;
      timeout: req.timeout,
      requestId: req.requestId,
    });

    const resFuture = this.dataFlowController[type](req.name, req, metadata);
    const pipeResult = await this._pipeResponse(resFuture, call);
    const end = Date.now();
    this.requestLogger.access(
      req.name,
      metadata,
      end - start,
      String(pipeResult.status),
      pipeResult.bytesSent,
      req.requestId
    );
    if (pipeResult.error) {
      this.requestLogger.error(
        req.name,
        pipeResult.error as Error,
        req.requestId
      );
    }
  }

  async invoke(
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<void> {
    const req = await this._parsePushServerDuplexStream(call);
    await this.#invoke('invoke', req, call);
  }

  async invokeService(
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<void> {
    const req = await this._parsePushServerDuplexStream(call);
    await this.#invoke('invokeService', req, call);
  }

  private _parsePushServerDuplexStream(
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ): Promise<InvokeRequest> {
    const readable = new Readable({
      read() {},
      destroy(err, cb) {
        cb(null);
      },
    }) as InvokeRequest;

    const deferred = createDeferred<InvokeRequest>();
    let headerReceived = false;
    call.on('data', (msg: root.noslated.data.IInvokeRequest) => {
      if (!headerReceived) {
        headerReceived = true;
        readable.name = msg.name!;
        readable.url = msg.url!;
        readable.method = msg.method!;
        readable.headers = msg.headers!;
        readable.baggage = msg.baggage!;
        readable.timeout = msg.timeout!;
        readable.requestId = msg.requestId!;
        deferred.resolve(readable);
      }
      if (msg.body) {
        readable.push(msg.body);
      }
    });
    call.on('end', () => {
      readable.push(null);
    });
    call.on('error', e => {
      readable.destroy(e);
    });

    return deferred.promise;
  }

  private async _pipeResponse(
    resFuture: Promise<TriggerResponse>,
    call: ServerDuplexStream<
      root.noslated.data.IInvokeRequest,
      root.noslated.data.IInvokeResponse
    >
  ): Promise<PipeResult> {
    let res: TriggerResponse;
    try {
      res = await resFuture;
    } catch (e) {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });
      return {
        status: 0,
        bytesSent: 0,
        error: e,
      };
    }

    call.write({
      result: {
        status: res.status,
        headers: tuplesToPairs(res.metadata.headers ?? []),
      },
    });

    const deferred = createDeferred<PipeResult>();
    let bytesSent = 0;
    res.on('data', chunk => {
      call.write({
        result: {
          body: chunk,
        },
      });
      bytesSent += chunk.byteLength;
    });
    res.on('end', () => {
      call.end();
      deferred.resolve({
        status: res.status,
        bytesSent,
      });
    });
    res.on('error', e => {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });
      deferred.resolve({
        status: res.status,
        bytesSent,
        error: e,
      });
    });

    return deferred.promise;
  }
}
