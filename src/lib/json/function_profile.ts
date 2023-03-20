import { DeepRequired, DeepReadonly } from '../util';

export type RuntimeType = 'nodejs' | 'aworker';
export type ShrinkStrategy = 'FILO' | 'FIFO' | 'LCC';

/**
 * Options needed to start a process
 */
export interface ProcessFunctionProfile {
  resourceLimit?: {
    memory?: number;
    cpu?: number;
  };
  worker?: {
    // + FILO: 先进后出
    // + FIFO: 先进先出
    // + LCC: 最少当前并发
    shrinkStrategy?: ShrinkStrategy;
    initializationTimeout?: number;
    maxActivateRequests?: number;
    reservationCount?: number;
    replicaCountLimit?: number;
    fastFailRequestsOnStarting?: boolean;
    v8Options?: string[];
    execArgv?: string[];
    disableSeed?: boolean;
    disposable?: boolean;
  };
  environments?: {
    key: string;
    value: string;
  }[];
  runtime: RuntimeType;
  rateLimit?: {
    maxTokenCount?: number;
    tokensPerFill?: number;
    fillInterval?: number;
  };
  namespace?: string;
}

interface BaseFunctionProfile {
  name: string;
  url: string;
  signature: string;
}

export interface NodejsFunctionProfile
  extends BaseFunctionProfile,
    ProcessFunctionProfile {
  runtime: 'nodejs';
  handler: string;
  initializer?: string;
}

export interface AworkerFunctionProfile
  extends BaseFunctionProfile,
    ProcessFunctionProfile {
  runtime: 'aworker';
  sourceFile: string;
}

export type RawFunctionProfile = NodejsFunctionProfile | AworkerFunctionProfile;

export const optionalKeys = ['rateLimit', 'namespace'] as const;
type OptionalKeys = (typeof optionalKeys)[number];
export type RawWithDefaultsFunctionProfile = DeepRequired<
  Omit<RawFunctionProfile, OptionalKeys>
> &
  Pick<RawFunctionProfile, OptionalKeys> &
  RawFunctionProfile;
export type ReadonlyProfile = DeepReadonly<RawWithDefaultsFunctionProfile>;
