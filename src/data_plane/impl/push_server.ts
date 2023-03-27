import loggers from '#self/lib/logger';
import { RequestLogger, RequestPerformance } from '../request_logger';
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
import { kDefaultQueueingTime, kDefaultWorkerName } from '#self/lib/constants';

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
  deadline: number;
  /** InvokeRequest requestId */
  requestId: string;
}

interface PipeResult {
  bytesSent: number;
  status: number;
  error?: unknown;
  workerName: string;
  performance: RequestPerformance;
}

export class PushServerImpl implements IPushServer {
  logger: Logger;
  requestLogger: RequestLogger;

  constructor(
    public dataFlowController: DataFlowController,
    public config: Config
  ) {
    this.logger = loggers.get('push server');
    this.requestLogger = new RequestLogger(this.config);
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
      deadline: req.deadline,
      requestId: req.requestId,
    });

    const resFuture = this.dataFlowController[type](req.name, req, metadata);
    const pipeResult = await this._pipeResponse(resFuture, call);
    const end = Date.now();
    this.requestLogger.access(
      req.name,
      pipeResult.workerName,
      metadata,
      start,
      end,
      String(pipeResult.status),
      pipeResult.bytesSent,
      req.requestId,
      pipeResult.performance
    );

    if (pipeResult.error) {
      this.requestLogger.error(
        req.name,
        pipeResult.workerName,
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
        readable.deadline = msg.deadline ?? Date.now() + 10_000;
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
    call.on('cancelled', () => {
      this.logger.debug('Call cancelled, aborting request');
      readable.destroy(new Error('Request aborted'));
    });
    call.on('error', e => {
      this.logger.debug('Call errored, aborting request');
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
    } catch (e: unknown) {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });

      let workerName = kDefaultWorkerName;
      let queueing = kDefaultQueueingTime;

      if (e instanceof Error) {
        workerName = e['workerName'];
        queueing = e['queueing'];
      }

      return {
        status: 0,
        bytesSent: 0,
        error: e,
        workerName,
        performance: {
          ttfb: Date.now(),
          queueing,
        },
      };
    }

    call.write({
      result: {
        status: res.status,
        headers: tuplesToPairs(res.metadata.headers ?? []),
      },
    });

    // time to first byte
    const ttfb = Date.now();

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
        workerName: res.workerName,
        performance: {
          ttfb,
          queueing: res.queueing,
        },
      });
    });
    res.on('error', e => {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });
      call.end();
      deferred.resolve({
        status: res.status,
        bytesSent,
        error: e,
        workerName: res.workerName,
        performance: {
          ttfb,
          queueing: res.queueing,
        },
      });
    });

    // destroy response when the call has been cancelled.
    call.on('cancelled', () => {
      this.logger.debug('Call cancelled, aborting response');
      res.destroy(new Error('Call cancelled.'));
    });
    call.on('error', e => {
      this.logger.debug('Call errored, aborting response');
      res.destroy(e);
    });

    return deferred.promise;
  }
}
