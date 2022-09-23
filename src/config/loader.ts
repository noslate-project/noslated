import extend from 'extend';
import fs from 'fs';
import path from 'path';
import Loggers from '#self/lib/logger';

import defaultConfig from './default';

const config = {};
const logger = Loggers.get('config-loader');

let localConfig = {};
try {
  localConfig = require('./local');
} catch (e) {
  //
}

export function resolveEnvConfig() {
  const envConfig: typeof defaultConfig = { delegate: {}, dirs: {}, turf: {}, logger: {}, worker: {} } as any;

  if (process.env.ALICE_WORKDIR) {
    envConfig.dirs.aliceWork = process.env.ALICE_WORKDIR;
    envConfig.dirs.aliceSock = path.join(envConfig.dirs.aliceWork, 'socks');
  }

  if (process.env.ALICE_PLATFORM_SERVER) {
    envConfig.dirs.alicePlatformServer = process.env.ALICE_PLATFORM_SERVER;
  }

  if (process.env.ALICE_LOG_LEVEL) {
    envConfig.logger.level = process.env.ALICE_LOG_LEVEL;
  }

  // Refs: https://yuque.antfin-inc.com/alinode-project/alinode-cloud/gqcmgi#9Veu0
  if (process.env.ALICE_LOGDIR) {
    envConfig.logger.dir = process.env.ALICE_LOGDIR;
  }

  // Debug version of Node.js may take longer time to bootstrap.
  if (process.env.ALICE_SOCK_CONN_TIMEOUT) {
    envConfig.delegate.sockConnectTimeout = Number.parseInt(process.env.ALICE_SOCK_CONN_TIMEOUT);
  }

  if (process.env.ALICE_DELEGATE_RAT) {
    envConfig.delegate.resourceAcquisitionTimeout = Number.parseInt(process.env.ALICE_DELEGATE_RAT);
  }

  if (process.env.ALICE_MAX_ACTIVATE_REQUESTS) {
    envConfig.worker.maxActivateRequests = Number.parseInt(process.env.ALICE_MAX_ACTIVATE_REQUESTS);
  }

  if (process.env.ALICE_REPLICA_COUNT_LIMIT_PER_FUNCTION) {
    envConfig.worker.replicaCountLimit = Number.parseInt(process.env.ALICE_REPLICA_COUNT_LIMIT_PER_FUNCTION);
  }

  if (process.env.ALICE_WORKER_SHRINK_REDUNDANT_TIMES) {
    envConfig.worker.shrinkRedundantTimes =
        Number.parseInt(process.env.ALICE_WORKER_SHRINK_REDUNDANT_TIMES);
  }

  if (process.env.ALICE_RESERVATION_WORKER_COUNT_PER_FUNCTION) {
    envConfig.worker.reservationCountPerFunction =
        Number.parseInt(process.env.ALICE_RESERVATION_WORKER_COUNT_PER_FUNCTION);
  }

  if (process.env.NATIVE_DEBUG) {
    envConfig.aliceAddonType = 'Debug';
  }

  if (process.env.ALICE_DISPATCH_STRATEGY_IDRS_MAX_IDLE) {
    envConfig.dispatchStrategy.idrs.idleDuration = Number.parseInt(process.env.ALICE_DISPATCH_STRATEGY_IDRS_MAX_IDLE);
  }

  if (process.env.ALICE_VIRTUAL_MEMORY_POOL_SIZE) {
    envConfig.virtualMemoryPoolSize = process.env.ALICE_VIRTUAL_MEMORY_POOL_SIZE;
  }

  if (process.env.ALICE_DATA_PANEL_COUNT) {
    envConfig.panel.dataPanelCount = Number.parseInt(process.env.ALICE_DATA_PANEL_COUNT);
  }

  if (process.env.ALICE_DEFAULT_SHRINK_STRATEGY) {
    envConfig.worker.defaultShrinkStrategy = process.env.ALICE_DEFAULT_SHRINK_STRATEGY;
  }

  if (process.env.ALICE_CONTROL_PANEL_COUNT) {
    envConfig.panel.controlPanelCount = Number.parseInt(process.env.ALICE_CONTROL_PANEL_COUNT);
  }

  if (process.env.ALICE_CONTROL_PANEL_WORKER_CONNECT_TIMEOUT) {
    envConfig.worker.controlPanelConnectTimeout = Number.parseInt(process.env.ALICE_CONTROL_PANEL_WORKER_CONNECT_TIMEOUT);
  }

  return envConfig;
}

export function resolveConfig() {
  let envFileConfig = {};
  if (process.env.ALICE_CONFIG_PATH) {
    try {
      envFileConfig = JSON.parse(fs.readFileSync(process.env.ALICE_CONFIG_PATH, 'utf8'));
    } catch (error) {
      logger.warn(`load config from ${process.env.ALICE_CONFIG_PATH} failed, `, error);
    }
  }
  const envConfig = resolveEnvConfig();
  return extend(/** deep */true, config, defaultConfig, localConfig, envFileConfig, envConfig);
}

export function dumpConfig(name: string, config: typeof defaultConfig) {
  try {
    const runDir = path.join(config.dirs.aliceWork, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, `${name}.config.json`), JSON.stringify(config, null, 2));
  } catch { /** do nothing */ }
}
