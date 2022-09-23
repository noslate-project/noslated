import cp from 'child_process';
import { config } from '#self/config';

const logger = require('../logger').get('turf/index');

const turfPath = config.turf.bin;
let turfDCP: cp.ChildProcess | undefined;

export const turf = new (require('./wrapper')).Turf(turfPath);
export { TurfContainerStates } from './types';

/* istanbul ignore next */
export function startTurfD() {
  logger.info('Starting turf...');
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
}
