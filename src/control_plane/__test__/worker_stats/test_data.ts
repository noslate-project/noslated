import { AworkerFunctionProfile } from '#self/lib/json/function_profile';
import { DeepRequired } from '#self/lib/util';
import { noslated } from '#self/proto/root';

export const funcData: AworkerFunctionProfile[] = [
  {
    name: 'func',
    url: `file://${__dirname}`,
    runtime: 'aworker',
    signature: 'xxx',
    sourceFile: 'index.js',
    worker: {
      maxActivateRequests: 10,
    },
    resourceLimit: {
      cpu: 1,
      memory: 512000000,
    },
  },
];

export const funcDataWithDefault = {
  ...funcData[0],
  worker: {
    fastFailRequestsOnStarting: false,
    initializationTimeout: 10000,
    maxActivateRequests: 10,
    replicaCountLimit: 10,
    reservationCount: 0,
    shrinkStrategy: 'LCC',
    v8Options: [],
    execArgv: [],
  },
  environments: [],
};

export const brokerData: DeepRequired<noslated.data.IBrokerStats>[] = [
  {
    functionName: 'func',
    inspector: true,
    workers: [
      {
        name: 'hello',
        activeRequestCount: 1,
      },
    ],
    concurrency: 1,
  },
  {
    functionName: 'func',
    inspector: false,
    workers: [
      {
        // turf sandbox name min length is 5
        name: 'foooo',
        activeRequestCount: 6,
      },
    ],
    concurrency: 6,
  },
];
