import { status, Metadata } from '@grpc/grpc-js';

interface Options {
  code?: number;
  details?: string;
  metadata?: Metadata;
}

export class RpcError extends Error {
  code;
  details;
  metadata;

  constructor(msg: string, options: Options = {}) {
    super(msg);
    this.code = options?.code ?? status.INTERNAL;
    this.details = options?.details;
    this.metadata = options?.metadata;
  }
}

export const RpcStatus = status;

export function rpcAssert(condition: any, message?: string): asserts condition {
  if (!condition) {
    throw new RpcError(message ?? 'assertion failed', {
      code: status.INVALID_ARGUMENT,
    });
  }
}
