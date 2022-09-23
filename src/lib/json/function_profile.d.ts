import { DeepRequired } from '../util';

export type RuntimeType = 'nodejs-v16' | 'aworker';
export type ShrinkStrategy = 'FILO' | 'FIFO' | 'LCC';

/**
 * Options needed to start a process
 */
interface ProcessFunctionProfile {
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
    useCGIMode?: boolean;
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

interface NodejsFunctionProfile extends BaseFunctionProfile, ProcessFunctionProfile {
  runtime: 'nodejs-v16';
  handler: string;
  initializer?: string;
}

interface ServerlessWorkerFunctionProfile extends BaseFunctionProfile, ProcessFunctionProfile {
  runtime: 'aworker';
  sourceFile: string;
}

export type RawFunctionProfile = NodejsFunctionProfile | ServerlessWorkerFunctionProfile;
export type RawWithDefaultsFunctionProfile = DeepRequired<RawFunctionProfile>;
