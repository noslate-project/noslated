import protobuf from 'protobufjs';
import * as protoLoader from '@grpc/proto-loader';
import * as grpc from '@grpc/grpc-js';

import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { RpcError } from './error';
import * as protoRoot from '../../proto/root';
import { loggers } from '../loggers';
import { config } from '#self/config';

grpc.setLogger(loggers.get('grpc'));
grpc.setLogVerbosity(grpc.logVerbosity.ERROR);

function loadDescriptor(includePaths: string[] = []) {
  const protoDir = path.resolve(__dirname, '../../../proto/alice');
  const files = [ protoDir, ...includePaths ].flatMap(dir => {
    const files = fs.readdirSync(dir).filter(it => it.endsWith('.proto'));
    return files.map(it => path.join(dir, it));
  });
  const root = protobuf.loadSync(files);
  const packageDefinition = protoLoader.loadSync(files, { keepCase: true });
  const grpcDescriptor = grpc.loadPackageDefinition(packageDefinition);
  return {
    root,
    grpcDescriptor,
  };
}

/**
 *
 * @param {object} delegate -
 * @param {grpc.Client} client -
 * @param {grpc.ServiceDefinition} clientDefinition -
 */
function delegateClientMethods(delegate: any, client: grpc.Client, clientDefinition: grpc.ServiceDefinition) {
  for (const [ method, descriptor ] of Object.entries(clientDefinition)) {
    if (method in delegate && delegate[method] !== undefined) {
      continue;
    }
    if (descriptor.requestStream || descriptor.responseStream) {
      delegate[method] = (client as any)[method].bind(client);
      continue;
    }
    delegate[method] = promisify((client as any)[method]).bind(client);
  }
}

/**
 *
 * @param {grpc.} serviceDefinition -
 * @param {object} impl -
 * @param {(err: any) => void} onerror -
 */
function delegateServiceImplementations(serviceDefinition: grpc.ServiceDefinition, impl: any, onerror?: (err: unknown) => void) {
  const delegate = Object.create(null);
  for (const [ method, descriptor ] of Object.entries(serviceDefinition)) {
    if (typeof impl[method] !== 'function') {
      continue;
    }
    if (descriptor.responseStream) {
      delegate[method] = (...args: any[]) => {
        impl[method](...args);
      };
      continue;
    }
    delegate[method] = (call: grpc.ServerUnaryCall<unknown, unknown>, callback: (error?: Error | null, resp?: unknown) => void) => {
      Promise.resolve()
        .then(() => {
          return impl[method](call);
        })
        .then(
          resp => {
            callback(null, resp);
          }, err => {
            const isUnexpected = !(err instanceof RpcError);
            callback(err);
            /** Not instanceof RpcError, may be unexpected. */
            if (isUnexpected) {
              onerror?.(err);
            }
          }
        );
    };
  }
  return delegate;
}


/**
 * @type {import('@grpc/grpc-js').ChannelOptions}
 */
const kDefaultChannelOptions = config.grpc.channelOptions;

const { root, grpcDescriptor } = loadDescriptor();
const RequestType = (root as any).nested.alice.RequestType as typeof protoRoot.alice.RequestType;
const HostEvents = {
  LIVENESS: 'host.liveness',
};

type ServerUnaryCall<T> = grpc.ServerUnaryCall<T, unknown>;

export {
  root,
  grpcDescriptor as descriptor,
  loadDescriptor,
  kDefaultChannelOptions,

  RequestType,
  HostEvents,

  delegateClientMethods,
  delegateServiceImplementations,

  ServerUnaryCall,
};
