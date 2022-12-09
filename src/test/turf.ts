import cp from 'child_process';
import path from 'path';
import { config } from '#self/config';
import { loggers } from '#self/lib/loggers';

const logger = loggers.get('test/turfd');

const turfPath = config.turf.bin;
let turfDCP: cp.ChildProcess | undefined;

function refreshTurfWorkspace() {
  const TURF_WORKDIR = process.env.TURF_WORKDIR!;
  for (const dir of ['overlay', 'sandbox']) {
    const absDir = path.join(TURF_WORKDIR, dir);
    cp.execSync(`rm -rf ${absDir}/*`);
  }
}

/* istanbul ignore next */
export function startTurfD() {
  const turfdOutput = process.env.TURFD_OUTPUT != null;
  logger.debug('Starting turf...');
  refreshTurfWorkspace();
  const turfd = turfDCP = cp.spawn(turfPath, [ '-D', '-f' ], {
    cwd: process.cwd(),
    env: process.env,
    stdio: [ 'ignore', 'pipe', 'pipe' ],
    detached: false,
  });

  turfd.on('exit', (code, signal) => {
    logger[signal === 'SIGKILL' ? 'warn' : 'error'](`turfd closed with ${code} / ${signal}`);
  });

  let data = '';
  turfd.stdout.on('data', chunk => {
    chunk = chunk.toString();
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '\n') {
        if (turfdOutput && !data.startsWith('tick =')) logger.info(data);
        data = '';
      } else {
        data += chunk[i];
      }
    }
  });

  let errData = '';
  turfd.stderr.on('data', chunk => {
    chunk = chunk.toString();
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '\n') {
        if (turfdOutput) logger.error(errData);
        errData = '';
      } else {
        errData += chunk[i];
      }
    }
  });
}

/* istanbul ignore next */
export async function stopTurfD() {
  if (turfDCP) {
    // disable logging.
    turfDCP.removeAllListeners('exit');
    turfDCP.kill('SIGKILL');
    turfDCP = undefined;
  }
  refreshTurfWorkspace();
}
