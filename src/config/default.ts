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
    expandConcurrency: 2,
    // worker launcher 扩容队列消费间隔
    expandInterval: 0,
  },

  dataPlane: {
    daprAdaptorModulePath: null,
    beaconHostModulePath: null,
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
    reservationCountPerFunction: 0,
    maxActivateRequests: 10,
    defaultInitializerTimeout: 10_000,
    replicaCountLimit: 10,
    // Noslated will check water level regularly. If water level is always too low
    // in continuous `shrinkRedundantTimes` times, some worker(s) will be
    // shrinked.
    shrinkRedundantTimes: 60,
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
  },

  dispatchStrategy: {
    idrs: {
      // 默认十分钟
      idleDuration: 10 * 60 * 1000,
    },
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
