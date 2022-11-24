import cp from 'child_process';
import path from 'path';
import { config } from '#self/config';
import { loggers } from '../loggers';

const logger = loggers.get('turf/index');

const turfPath = config.turf.bin;
let turfDCP: cp.ChildProcess | undefined;

export { TurfContainerStates } from './types';
export { Turf } from './wrapper';

function refreshTurfWorkspace() {
  const TURF_WORKDIR = process.env.TURF_WORKDIR!;
  for (const dir of ['overlay', 'sandbox']) {
    const absDir = path.join(TURF_WORKDIR, dir);
    cp.execSync(`rm -rf ${absDir}/*`);
  }
}

/* istanbul ignore next */
export function startTurfD() {
  logger.info('Starting turf...');
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
    console.log('turf', chunk);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '\n') {
        if (config.turf.startTurfDOutput && !data.startsWith('tick =')) logger.info(data);
        data = '';
      } else {
        data += chunk[i];
      }
    }
  });

  let errData = '';
  turfd.stderr.on('data', chunk => {
    chunk = chunk.toString();
    console.log('turf', chunk);
    for (let i = 0; i < chunk.length; i++) {
      if (chunk[i] === '\n') {
        if (config.turf.startTurfDOutput) logger.error(errData);
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
    turfDCP.kill('SIGKILL');
    turfDCP = undefined;
  }
  refreshTurfWorkspace();
}
