import os from 'os';
import path from 'path';
import { isatty } from 'tty';

process.env.NOSLATED_LOG_LEVEL = 'debug';
process.env.NOSLATED_SOCKS_DIR = path.join(
  os.tmpdir(),
  `noslated-socks-${Date.now()}`
);
process.env.NOSLATED_FORCE_NON_SEED_MODE = 'true';
process.env.NOSLATED_CONTROL_PLANE_WORKER_CONNECT_TIMEOUT = '30000';
process.env.MIDWAY_LOGGER_DISABLE_COLORS =
  isatty(process.stdout as any) || process.env.COLORTERM === 'truecolor'
    ? 'false'
    : 'true';

// See https://github.com/nodejs/node/issues/37236
// Force GC before node shutdown.
process.on('exit', () => {
  if (global.gc) {
    global.gc();
  }
});
