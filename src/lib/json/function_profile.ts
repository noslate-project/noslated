import { DeepRequired, DeepReadonly } from '../util';

export type RuntimeType = 'nodejs' | 'aworker';
export type ShrinkStrategy = 'FILO' | 'FIFO' | 'LCC';
export type DispatchMode = 'least-request-count' | 'round-robin';

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
    disableRequestQueue?: boolean;
    v8Options?: string[];
    execArgv?: string[];
    disableSeed?: boolean;
    disposable?: boolean;
    /**
     * Not applicable if `disposable` is true.
     */
    dispatchMode?: DispatchMode;
    // 并发度滑动时间窗口大小，单位 ms，默认 60s
    concurrencySlidingWindowSize?: number;
    // 并发度滑动时间窗口分桶数，默认 6
    concurrencySlidingBucketCount?: number;
    // 指数移动平均平滑系数 (0,1]，默认 0.5
    emaConcurrencyAlpha?: number;
    // 并发度扩容水位阈值，默认 0.7
    concurrencyExpandThreshold?: number;
    // 并发度缩容水位阈值，默认 0.3
    concurrencyShrinkThreshold?: number;
    // 扩容冷却时间，单位 ms，默认 1s
    expandCooldown?: number;
    // 缩容冷却时间，单位 ms，默认 60s
    shrinkCooldown?: number;
    // 扩缩容后并发度水位，影响扩缩容操作数量
    scaleFactor?: number;
    // ema concurrency 小于该值则视为 0
    precisionZeroThreshold?: number;
    // worker 并发度统计算法
    concurrencyStatsMode?: ConcurrencyStatsMode;
    // 启动后是否进入缩容冷却期，默认为 false
    shrinkCooldownOnStartup?: boolean;
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

export enum ConcurrencyStatsMode {
  // 瞬时值，默认行为，和原来保持一致
  INSTANT = 'instant',
  // 拉取区间内最大瞬时值
  PERIODIC_MAX = 'periodic_max',
  // 拉取区间内平均值，使用 QPS * RT 计算
  PERIODIC_AVG = 'periodic_avg',
}
