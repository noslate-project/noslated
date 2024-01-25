import { ConcurrencyStatsMode } from '#self/lib/json/function_profile';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../../');

export default {
  projectRoot,

  plane: {
    dataPlaneCount: 1,
    controlPlaneCount: 1,
    planeFirstConnectionTimeout: 10_000,
  },

  controlPlane: {
    // worker launcher 扩容并发度
    expandConcurrency: 4,
    workerTrafficStatsPullingMs: 10_000,
    workerRedundantVictimSpareTimes: 6,
    capacityScalingStage: 0.7,
    useEmaScaling: false,
    dumpWorkerTrafficStats: false,
  },

  dataPlane: {
    daprAdaptorModulePath: undefined,
    daprAdaptorModuleOptions: undefined,
    beaconHostModulePath: undefined,
    closeTrafficTimeout: 30_000,
  },

  dirs: {
    noslatedSock: path.join(projectRoot, '.code/socks'),
    noslatedWork: path.join(projectRoot, '.code'),
  },

  noslatedAddonType: 'Release',
  virtualMemoryPoolSize: '1gb',
  worker: {
    defaultShrinkStrategy: 'LCC',
    gcLogDelay: 5 * 1000 * 60,
    gcLogHighWaterMark: 100,
    reservationCountPerFunction: 0,
    maxActivateRequests: 10,
    defaultInitializerTimeout: 10_000,
    replicaCountLimit: 10,

    // ema 相关默认值
    concurrencySlidingWindowSize: 60_000,
    concurrencySlidingBucketCount: 6,
    emaConcurrencyAlpha: 0.5,
    concurrencyExpandThreshold: 0.7,
    concurrencyShrinkThreshold: 0.3,
    expandCooldown: 1000,
    shrinkCooldown: 60_000,
    scaleFactor: 0.5,
    precisionZeroThreshold: 0.01,
    concurrencyStatsMode: ConcurrencyStatsMode.INSTANT,
    shrinkCooldownOnStartup: true,
  },
  starter: {
    aworker: {
      defaultSeedScript: null,
      defaultEnvirons: {},
    },
  },

  turf: {
    bin: path.join(projectRoot, 'bin/turf'),
    socketPath: path.join(projectRoot, '.turf/turf.sock'),
    socketSession: true,
    gracefulExitPeriodMs: 3000,
    reconcilingInterval: 1000,
  },

  delegate: {
    sockConnectTimeout: 5000,
    resourceAcquisitionTimeout: 10_000,

    // Per-function storage max byte length:
    // kvStoragePerNamespaceCapacity * kvStoragePerNamespaceMaxByteLength
    kvStoragePerNamespaceCapacity: 8,
    kvStoragePerNamespaceMaxSize: 4096,
    kvStoragePerNamespaceMaxByteLength: 256 * 1024 * 1024,
  },

  systemCircuitBreaker: {
    requestCountLimit: 10000,
    pendingRequestCountLimit: 1000,
    systemLoad1Limit: 10,
  },

  logger: {
    level: 'info',
    dir: path.join(projectRoot, '.code/logs'),
    enableConsole: false,
    // keep in touch with @midwayjs/logger default
    // only influence on access/error/resource log now
    // TODO: set to @midwayjs/logger instance when support
    timestampFormat: 'YYYY-MM-DD HH:mm:ss.SSS',
  },

  grpc: {
    /**
     * @see https://github.com/grpc/grpc-node/tree/master/packages/grpc-js#supported-channel-options
     */
    channelOptions: {
      'grpc.max_receive_message_length': /* 10M */ 10 * 1024 * 1024,
      'grpc.max_send_message_length': /* 10M */ 10 * 1024 * 1024,
      /** disable grpc global subchannel pool */
      'grpc.use_local_subchannel_pool': 1,
      'grpc-node.max_session_memory': /* 10M, in megabytes */ 10,
    },
  },
};
