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
