import EventEmitter from 'events';
import path from 'path';
import { loadPackageDefinition } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { config } from '#self/config';
import { FIXTURES_DIR } from '#self/test/util';

const packageDefinition = loadSync(path.join(FIXTURES_DIR, 'proto/test.proto'), { keepCase: true });
export const grpcDescriptor = loadPackageDefinition(packageDefinition);

export const address = `unix://${config.dirs.noslatedSock}/test.sock`;

export function once(target: any, event: string) {
  console.log('waiting for event:', event);
  return EventEmitter.once(target, event)
    .then(value => {
      console.log('event resolved:', event);
      return value;
    });
}
