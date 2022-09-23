import loggers from '#self/lib/logger';
import { RequestLogger } from '../request_logger';
import { bufferFromStream } from '#self/lib/util';
import { Metadata, TriggerResponse } from '#self/delegate/request_response';
import { tuplesToPairs, pairsToTuples } from '#self/lib/rpc/key_value_pair';
import { DataFlowController } from '../data_flow_controller';
import { Config } from '#self/config';
import { Logger } from '#self/lib/loggers';
import { ServerWritableStream } from '@grpc/grpc-js';
import * as root from '#self/proto/root';
import { NotNullableInterface } from '#self/lib/interfaces';
import { InvokeResponse, IPushServer } from '#self/lib/interfaces/push_server';

export class PushServerImpl implements IPushServer {
  /**
   * @param {import('../data_flow_controller').DataFlowController} dataFlowController -
   * @param {import('#self/config')} config -
   */
  logger: Logger;
  requestLogger: RequestLogger;

  constructor(public dataFlowController: DataFlowController, public config: Config) {
    this.logger = loggers.get('push server');
    this.requestLogger = new RequestLogger();
  }

  async #invoke(type: string, { name, body, url, method, headers, baggage, timeout, requestId }: NotNullableInterface<root.alice.data.IInvokeRequest>) {
    const start = Date.now();
    const metadata = new Metadata({
      url,
      method,
      headers: pairsToTuples(headers as NotNullableInterface<root.alice.IKeyValuePair>[] ?? []),
      baggage: pairsToTuples(baggage as NotNullableInterface<root.alice.IKeyValuePair>[] ?? []),
      // TODO: negotiate with deadline;
      timeout,
      requestId
    });
    let bytesSent = 0;
    let status = 0;
    let error: unknown;

    try {
      const response: TriggerResponse = await this.dataFlowController[type](name, body, metadata);
      const data = await bufferFromStream(response);
      bytesSent = data.byteLength;
      status = response.status;
      return {
        result: {
          status: response.status,
          headers: tuplesToPairs(response.metadata.headers ?? []),
          body: data,
        },
      };
    } catch (e: unknown) {
      error = e;
      return {
        error: e,
      };
    } finally {
      const end = Date.now();
      this.requestLogger.access(name as string, metadata, end - start, String(status), bytesSent, requestId);
      if (error) {
        this.requestLogger.error(name as string, error as Error, requestId);
      }
    }
  }

  async invoke(call: ServerWritableStream<root.alice.data.InvokeRequest, root.alice.data.InvokeResponse>): Promise<InvokeResponse> {
    const { name, body, url, method, headers, baggage, timeout, requestId } = call.request;
    return this.#invoke('invoke', { name, body, url, method, headers, baggage, timeout, requestId } as NotNullableInterface<root.alice.data.IInvokeRequest>);
  }

  async invokeService(call: ServerWritableStream<root.alice.data.InvokeRequest, root.alice.data.InvokeResponse>): Promise<InvokeResponse> {
    const { name, body, url, method, headers, baggage, timeout, requestId } = call.request;
    return this.#invoke('invokeService', { name, body, url, method, headers, baggage, timeout, requestId } as NotNullableInterface<root.alice.data.IInvokeRequest>);
  }
}
