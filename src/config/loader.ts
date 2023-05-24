import extend from 'extend';
import fs from 'fs';
import path from 'path';

import defaultConfig from './default';
import { Config } from '.';

const config = {};

let localConfig = {};
try {
  localConfig = require('./local');
} catch (e) {
  //
}

export function resolveEnvConfig() {
  const envConfig: typeof defaultConfig = {
    delegate: {},
    dirs: {},
    turf: {},
    logger: {},
    worker: {},
  } as any;

  if (process.env.NOSLATED_WORKDIR) {
    envConfig.dirs.noslatedWork = process.env.NOSLATED_WORKDIR;
    envConfig.dirs.noslatedSock = path.join(
      envConfig.dirs.noslatedWork,
      'socks'
    );
  }

  if (process.env.TURF_WORKDIR) {
    envConfig.turf.socketPath = path.join(
      process.env.TURF_WORKDIR,
      'turf.sock'
    );
  }

  if (process.env.NOSLATED_LOG_LEVEL) {
    envConfig.logger.level = process.env.NOSLATED_LOG_LEVEL;
  }

  if (process.env.NOSLATED_LOG_CONSOLE) {
    envConfig.logger.enableConsole = true;
  }

  if (process.env.NOSLATE_LOGDIR) {
    envConfig.logger.dir = process.env.NOSLATE_LOGDIR;
  }

  // Debug version of Node.js may take longer time to bootstrap.
  if (process.env.NOSLATED_SOCK_CONN_TIMEOUT) {
    envConfig.delegate.sockConnectTimeout = Number.parseInt(
      process.env.NOSLATED_SOCK_CONN_TIMEOUT
    );
  }

  if (process.env.NOSLATED_DELEGATE_RAT) {
    envConfig.delegate.resourceAcquisitionTimeout = Number.parseInt(
      process.env.NOSLATED_DELEGATE_RAT
    );
  }

  if (process.env.NOSLATED_MAX_ACTIVATE_REQUESTS) {
    envConfig.worker.maxActivateRequests = Number.parseInt(
      process.env.NOSLATED_MAX_ACTIVATE_REQUESTS
    );
  }

  if (process.env.NOSLATED_REPLICA_COUNT_LIMIT_PER_FUNCTION) {
    envConfig.worker.replicaCountLimit = Number.parseInt(
      process.env.NOSLATED_REPLICA_COUNT_LIMIT_PER_FUNCTION
    );
  }

  if (process.env.NOSLATED_RESERVATION_WORKER_COUNT_PER_FUNCTION) {
    envConfig.worker.reservationCountPerFunction = Number.parseInt(
      process.env.NOSLATED_RESERVATION_WORKER_COUNT_PER_FUNCTION
    );
  }

  if (process.env.NATIVE_DEBUG) {
    envConfig.noslatedAddonType = 'Debug';
  }

  if (process.env.NOSLATED_VIRTUAL_MEMORY_POOL_SIZE) {
    envConfig.virtualMemoryPoolSize =
      process.env.NOSLATED_VIRTUAL_MEMORY_POOL_SIZE;
  }

  if (process.env.NOSLATED_DATA_PLANE_COUNT) {
    envConfig.plane.dataPlaneCount = Number.parseInt(
      process.env.NOSLATED_DATA_PLANE_COUNT
    );
  }

  if (process.env.NOSLATED_DEFAULT_SHRINK_STRATEGY) {
    envConfig.worker.defaultShrinkStrategy =
      process.env.NOSLATED_DEFAULT_SHRINK_STRATEGY;
  }

  if (process.env.NOSLATED_CONTROL_PLANE_COUNT) {
    envConfig.plane.controlPlaneCount = Number.parseInt(
      process.env.NOSLATED_CONTROL_PLANE_COUNT
    );
  }

  return envConfig;
}

export function resolveConfig(): Config {
  const platformFileConfig = loadConfig(
    process.env.NOSLATED_PLATFORM_CONFIG_PATH
  );
  const userFileConfig = loadConfig(process.env.NOSLATED_CONFIG_PATH);
  const envConfig = resolveEnvConfig();
  return extend(
    /** deep */ true,
    config,
    defaultConfig,
    localConfig,
    platformFileConfig,
    userFileConfig,
    envConfig
  );
}

export function dumpConfig(name: string, config: Config) {
  try {
    const runDir = path.join(config.dirs.noslatedWork, 'run');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(
      path.join(runDir, `${name}.config.json`),
      JSON.stringify(config, null, 2)
    );
  } catch {
    /** do nothing */
  }
}

function loadConfig(maybePath: string | undefined) {
  let config = {};
  if (maybePath) {
    try {
      config = require(maybePath);
    } catch (error) {
      console.warn(`load config from ${maybePath} failed`, error);
    }
  }
  return config;
}
