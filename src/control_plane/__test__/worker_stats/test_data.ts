import { AworkerFunctionProfile } from '#self/lib/json/function_profile';

export const funcData: AworkerFunctionProfile[] = [
  {
    name: 'func',
    url: `file://${__dirname}`,
    runtime: 'aworker',
    signature: 'xxx',
    sourceFile: 'index.js',
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
};

export const brokerData = [
  {
    functionName: 'func',
    inspector: true,
    workers: [
      {
        name: 'hello',
        credential: 'world',
        maxActivateRequests: 10,
        activeRequestCount: 1,
      },
    ],
  },
  {
    functionName: 'func',
    inspector: false,
    workers: [
      {
        // turf sandbox name min length is 5
        name: 'foooo',
        credential: 'bar',
        maxActivateRequests: 10,
        activeRequestCount: 6,
      },
    ],
  },
];
