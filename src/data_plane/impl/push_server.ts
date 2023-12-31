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
import { LoggerFactory, PrefixedLogger } from '#self/lib/logger_factory';

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
  debuggerTag?: string;
}

export class PushServerImpl implements IPushServer {
  logger: PrefixedLogger;

  constructor(
    public dataFlowController: DataFlowController,
    public config: Config
  ) {
    this.logger = LoggerFactory.prefix('push server');
  }

  async #invoke(
    type: string,
    req: InvokeRequest,
    call: ServerDuplexStream<
      root.noslated.data.InvokeRequest,
      root.noslated.data.InvokeResponse
    >
  ) {
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
      debuggerTag: req.debuggerTag,
    });

    const resFuture = this.dataFlowController[type](req.name, req, metadata);

    await this._pipeResponse(resFuture, call);
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
        readable.debuggerTag = msg.debuggerTag!;
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
  ): Promise<void> {
    let res: TriggerResponse;
    try {
      res = await resFuture;
    } catch (e: unknown) {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });

      return;
    }

    call.write({
      result: {
        status: res.status,
        headers: tuplesToPairs(res.metadata.headers ?? []),
      },
    });

    const deferred = createDeferred<void>();

    res.on('data', chunk => {
      call.write({
        result: {
          body: chunk,
        },
      });
    });

    res.on('end', () => {
      call.end();
      deferred.resolve();
    });
    res.on('error', e => {
      call.write({
        error: e as root.noslated.data.IInvokeErrorResponse,
      });
      call.end();
      deferred.resolve();
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
