import type { LoggerLevel } from '@midwayjs/logger';
import type { ChannelOptions } from '@grpc/grpc-js';
import { resolveConfig } from './loader';

export const config = resolveConfig();
export { dumpConfig } from './loader';

export interface Config {
  /**
   * 项目运行根目录
   */
  projectRoot: string;

  /**
   * 位面通用配置
   */
  plane: PlaneCommonConfig;

  /**
   * 控制面配置
   */
  controlPlane: ControlPlaneConfig;

  /**
   * 数据面配置
   */
  dataPlane: DatePlaneConfig;

  /**
   * 目录配置
   */
  dirs: DirConfig;

  /**
   * addon 模块类型
   * 默认 Release
   */
  noslatedAddonType: 'Release' | 'Debug';

  /**
   * 虚拟内存池大小
   * 格式参考 bytes 模块
   * 默认 1gb
   */
  virtualMemoryPoolSize: string;

  /**
   * 实例默认配置
   */
  worker: WorkerDefaultConfig;

  /**
   * Starter 配置
   */
  starter: StarterConfig;

  /**
   * Turf 配置
   */
  turf: TurfConfig;

  /**
   * Delegate 配置
   */
  delegate: DelegateConfig;

  /**
   * 系统熔断器配置
   */
  systemCircuitBreaker: SystemCircuitBreakerConfig;

  /**
   * 日志配置
   */
  logger: LoggerConfig;

  grpc: GrpcConfig;
}

export interface PlaneCommonConfig {
  /**
   * 数据面启动数量
   * 默认为 1
   */
  dataPlaneCount: number;
  /**
   * 控制面启动数量
   * 默认为 1
   */
  controlPlaneCount: number;
  /**
   * 位面初次建连超时时间，单位毫秒
   * 默认 10s
   */
  planeFirstConnectionTimeout: number;
}

export interface ControlPlaneConfig {
  /**
   * 实例扩容并发度
   * 默认为 4
   */
  expandConcurrency: number;
  /**
   * Worker traffic stats pulling interval in milliseconds.
   * Default: 10_000ms
   */
  workerTrafficStatsPullingMs: number;
  /**
   * Default: 6
   */
  workerRedundantVictimSpareTimes: number;
  /**
   * Default: 0.7
   */
  capacityScalingStage: number;
  /**
   * 使用基于时间窗口的移动加权平均算法进行扩容
   * 默认为 false
   * 此配置开启会强制设置 workerTrafficStatsPullingMs 为 1000ms，确保数据同步及时
   */
  useEmaScaling: boolean;
  /**
   * 输出 worker traffic stats 同步数据
   * 默认为 false
   */
  dumpWorkerTrafficStats: boolean;
}

export interface DatePlaneConfig {
  /**
   * Dapr Adaptor 模块路径
   */
  daprAdaptorModulePath?: string;
  /**
   * Dapr Adaptor 模块参数
   */
  daprAdaptorModuleOptions?: unknown;
  /**
   * Beacon Host 模块路径
   */
  beaconHostModulePath?: string;
}

export interface DirConfig {
  /**
   * noslated socks 目录
   */
  noslatedSock: string;
  /**
   * noslated 工作目录
   */
  noslatedWork: string;
}

export enum ShrinkStrategy {
  /**
   * 销毁最小当前并发
   */
  LCC = 'LCC',
  /**
   * 先创建后销毁
   */
  FILO = 'FILO',
  /**
   * 先创建先销毁
   */
  FIFO = 'FIFO',
}

export interface WorkerDefaultConfig {
  /**
   * 缩容策略
   * 默认为 LCC
   */
  defaultShrinkStrategy: ShrinkStrategy;
  /**
   * 实例退出后日志清理延时，单位毫秒
   * 默认为 5min
   */
  gcLogDelay: number;
  /**
   * 日志清理队列最高水位，超过则立即执行清理
   * 默认为 100
   */
  gcLogHighWaterMark: number;
  /**
   * 每个函数预留实例数
   * 默认为 0
   */
  reservationCountPerFunction: number;
  /**
   * 单实例最大同时执行请求数
   * 默认为 10
   */
  maxActivateRequests: number;
  /**
   * 初始化超时时间，单位毫秒
   * 默认为 10s
   */
  defaultInitializerTimeout: number;
  /**
   * 单函数实例上限
   * 默认为 10
   */
  replicaCountLimit: number;
}

export interface StarterConfig {
  aworker: AworkerStarterConfig;
  nodejs: NodejsStarterConfig;
}

export interface AworkerStarterConfig {
  /**
   * 全局 seed 代码地址
   */
  defaultSeedScript?: string;
  /**
   * 默认集成环境变量
   */
  defaultEnvirons?: Record<string, string>;
}

export interface NodejsStarterConfig {
  /**
   * 默认集成环境变量
   */
  defaultEnvirons?: Record<string, string>;
}

export interface TurfConfig {
  /**
   * turf 执行文件地址
   */
  bin: string;
  /**
   * turf socket 地址
   */
  socketPath: string;
  /**
   * 是否使用 ipc 执行命令 create, start, run
   * 默认为 true
   */
  socketSession: boolean;
  /**
   * 实例优雅退出等待时间，单位为毫秒
   * 默认为 3s
   */
  gracefulExitPeriodMs: number;
  /**
   * 同步 turf 实例状态间隔，单位为毫秒
   * 默认为 1s
   */
  reconcilingInterval: number;
}

export interface DelegateConfig {
  /**
   * 连接超时时间，单位为毫秒
   * 默认为 5s
   */
  sockConnectTimeout: number;
  /**
   * Cache 建立时写权限授权时间，单位为毫秒
   * 默认为 10s
   */
  resourceAcquisitionTimeout: number;

  // Per-function storage max byte length:
  // kvStoragePerNamespaceCapacity * kvStoragePerNamespaceMaxByteLength
  /**
   * 单 Namespace 下可开辟的 KV Storage 数量
   * 默认为 8
   */
  kvStoragePerNamespaceCapacity: number;
  /**
   * 单 Namespace 下每个 KV Storage 的最大 Entry 数量
   * 默认为 4096
   */
  kvStoragePerNamespaceMaxSize: number;
  /**
   * 单 Namespace 下每个 KV Storage 的最大存储 bytes，单位 bytes
   * 默认为 256MB
   */
  kvStoragePerNamespaceMaxByteLength: number;
}

export interface SystemCircuitBreakerConfig {
  /**
   * 总请求数上限
   * 默认为 10000
   */
  requestCountLimit: number;
  /**
   * 待执行的请求数上限
   * 默认为 1000
   */
  pendingRequestCountLimit: number;
  /**
   * 系统 load1 触发阈值
   * 默认为 10
   */
  systemLoad1Limit: number;
}

export interface LoggerConfig {
  /**
   * 日志输出等级下限
   */
  level: LoggerLevel;
  /**
   * 日志根目录
   */
  dir: string;
  /**
   * 是否开启控制台输出
   * 默认为 false
   */
  enableConsole: boolean;
  /**
   * 时间戳格式
   * 默认为 YYYY-MM-DD HH:mm:ss.SSS
   */
  timestampFormat: string;
  /**
   * 自定义 LoggerFactory 模块路径
   * module.exports = CustomLoggerFactory;
   */
  customFactoryPath?: string;
}

export interface GrpcConfig {
  /**
   * Grpc Channel 配置
   * @see https://github.com/grpc/grpc-node/tree/master/packages/grpc-js#supported-channel-options
   * 默认为
   * 'grpc.max_receive_message_length': 10M
   * 'grpc.max_send_message_length': 10M
   * 'grpc.use_local_subchannel_pool': 1,
   * 'grpc-node.max_session_memory': 10M,
   */
  channelOptions: ChannelOptions;
}
