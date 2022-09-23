import cp from 'child_process';

import Logger from '../logger';
import { createDeferred, isNotNullish } from '../util';
import { TurfStartOptions, TurfException, TurfProcess, TurfState } from './types';

const logger = Logger.get('turf/wrapper');

const TurfPsLineMatcher = /(\S+)\s+(\d+)\s+(\S+)/;
const TurfStateLineMatcher = /(\S+):\s+(\S+)/;

export { TurfContainerStates } from './types';

export class Turf {
  constructor(public turfPath: string) {}

  #exec(args: string[], cwd?: string) {
    const cmd = this.turfPath;

    const deferred = createDeferred<string>();

    const opt: cp.SpawnOptions = { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] };
    if (cwd) {
      opt.cwd = cwd;
    }

    const command = [ cmd ].concat(args).join(' ');
    const start = process.hrtime.bigint();
    const child = cp.spawn(cmd, args, opt);
    const result = {
      stdout: [] as Buffer[],
      stderr: [] as Buffer[],
    };
    child.stdout!.on('data', chunk => {
      result.stdout.push(chunk);
    });
    child.stderr!.on('data', chunk => {
      result.stderr.push(chunk);
    });
    // Listen on 'close' event instead of 'exit' event to wait stdout and stderr to be closed.
    child.on('close', (code, signal) => {
      logger.debug(`ran ${command}, cwd: ${opt.cwd || process.cwd()}, consume %s`, process.hrtime.bigint() - start);
      const stdout = Buffer.concat(result.stdout).toString('utf8');
      if (code !== 0) {
        const stderr = Buffer.concat(result.stderr).toString('utf8')
        const err = new Error(`Turf exited with non-zero code(${code}, ${signal}): ${stderr}`) as TurfException;
        err.code = code;
        err.signal = signal;
        err.stderr = stderr;
        err.stdout = stdout;
        return deferred.reject(err);
      }
      deferred.resolve(stdout);
    });

    return deferred.promise;
  }

  async run(containerName: string, bundlePath: string) {
    // TODO: nullibility of name
    return await this.#exec([ 'run', containerName ], bundlePath);
  }

  async create(containerName: string, bundlePath: string) {
    // TODO: nullibility of name
    return await this.#exec([ 'create', containerName ], bundlePath);
  }

  async start(containerName: string, options: TurfStartOptions = {}) {
    // TODO: nullibility of name
    const args = [ '-H', 'start' ];

    const ADDITIONAL_KEYS = [ 'seed', 'stdout', 'stderr' ] as const;
    for (const key of ADDITIONAL_KEYS) {
      const val = options[key];
      if (val) {
        args.push(`--${key}`);
        args.push(val);
      }
    }

    args.push(containerName);

    return this.#exec(args);
  }

  async stop(containerName: string) {
    // TODO: nullibility of name
    let ret;
    try {
      ret = await this.#exec([ '-H', 'stop', containerName ]);
    } catch (e: any) {
      if (e.code !== 255) { // aka. -1
        return e.stdout;
      }

      logger.warn(`${containerName} stop failed, try to force stop`, e);
      try {
        ret = await this.#exec([ '-H', 'stop', '--force', containerName ]);
      } catch (e: any) {
        logger.warn(`${containerName} force stop failed, ignore error`, e);
        return e.stdout;
      }
    }

    return ret;
  }

  async delete(containerName: string) {
    // TODO: nullibility of name
    return this.#exec([ 'delete', containerName ]);
  }

  async destroy(containerName: string) {
    // TODO: nullibility of name
    await this.stop(containerName);
    // TODO: stop 之后可能要等一下才能 delete
    await this.delete(containerName);
  }

  async destroyAll() {
    const all = (await this.ps()).map(obj => this.destroy(obj.name));
    await Promise.all(all);
  }

  /**
   * ps
   */
  async ps(): Promise<TurfProcess[]> {
    const ret = await this.#exec([ 'ps' ]);
    const lines = ret.split('\n').filter(l => l);
    if (!lines.length) return [];
    const arr = lines.map(line => {
      const match = TurfPsLineMatcher.exec(line);
      if (match == null) {
        return null;
      }
      const [ /** match */, name, pid, status ] = match;
      return {
        status,
        pid: Number.parseInt(pid),
        name,
      } as TurfProcess;
    }).filter(isNotNullish);

    return arr;
  }

  async state(name: string): Promise<TurfState | null> {
    // TODO: nullibility of name
    const ret = await this.#exec([ 'state', name ]);
    const lines = ret.split('\n').filter(l => l);
    if (!lines.length) return null;
    const obj = lines.reduce((obj, line) => {
      // Output format and semantics: https://yuque.antfin.com/alinode-project/alinode-cloud/utlp6l
      const match = TurfStateLineMatcher.exec(line);
      if (match == null) {
        return obj;
      }
      let [ /** match */, name, value ] = match;
      if (name === 'pid' || name.startsWith('stat.') || name.startsWith('rusage.')) {
        obj[name] = Number.parseInt(value);
      } else {
        obj[name] = value;
      }
      return obj;
    }, {} as Record<string, string | number>);

    return obj as unknown as TurfState;
  }
}
