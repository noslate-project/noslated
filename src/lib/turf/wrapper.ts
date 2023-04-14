import { config } from '#self/config';
import cp from 'child_process';

import Logger from '../logger';
import { createDeferred, isNotNullish } from '../util';
import { TurfSession } from './session';
import {
  TurfStartOptions,
  TurfException,
  TurfProcess,
  TurfState,
  TurfCode,
  TurfContainerStates,
  TurfRunOptions,
} from './types';

const logger = Logger.get('turf/wrapper');

const TurfPsLineMatcher = /(\S+)\s+(\d+)\s+(\S+)/;
const TurfStateLineMatcher = /(\S+):\s+(\S+)/;

export { TurfContainerStates } from './types';

const TurfStopIgnorableCodes = [TurfCode.ECHILD, TurfCode.ENOENT];

export class Turf {
  session: TurfSession;
  sessionConnectedDeferred = createDeferred<void>();
  constructor(public turfPath: string, public sockPath: string) {
    this.session = new TurfSession(sockPath);
    this.session.on('error', err => this._onSessionError(err));
  }

  private _onSessionError(err: unknown) {
    logger.error('unexpected error on turf session:', err);
    this.session = new TurfSession(this.sockPath);
    this.session.on('error', err => this._onSessionError(err));
    this.session.connect().then(
      () => {
        logger.info('turf session re-connected');
        this.sessionConnectedDeferred.resolve();
      },
      () => {
        /** identical to error event */
      }
    );
  }

  async connect() {
    this.session.connect().then(
      () => {
        logger.info('turf session connected');
        this.sessionConnectedDeferred.resolve();
      },
      () => {
        /** identical to error event */
      }
    );
    return this.sessionConnectedDeferred.promise;
  }

  async close() {
    await this.session.close();
  }

  #exec(args: string[], cwd?: string) {
    const cmd = this.turfPath;

    const deferred = createDeferred<string>();

    const opt: cp.SpawnOptions = {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    };
    if (cwd) {
      opt.cwd = cwd;
    }

    const command = [cmd].concat(args).join(' ');
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
      logger.debug(
        `ran ${command}, cwd: ${opt.cwd || process.cwd()}, consume %s ns`,
        process.hrtime.bigint() - start
      );
      const stdout = Buffer.concat(result.stdout).toString('utf8');
      if (code !== 0) {
        const stderr = Buffer.concat(result.stderr).toString('utf8');
        const err = new Error(
          `Turf exited with non-zero code(${code}, ${signal}): ${stderr}`
        ) as TurfException;
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

  async #send(args: string[]) {
    const start = process.hrtime.bigint();
    const command = args.join(' ');
    const ret = await this.session.send(args).finally(() => {
      logger.debug(
        'send %s, consume %s ns',
        command,
        process.hrtime.bigint() - start
      );
    });
    if (ret.header.code !== 0) {
      const err = new TurfError(ret.header.code, args);
      throw err;
    }
  }

  #sendOrExec(args: string[]) {
    if (config.turf.socketSession) {
      return this.#send(args);
    } else {
      return this.#exec(args);
    }
  }

  async create(containerName: string, bundlePath: string, config?: string) {
    const args = ['create', '-b', bundlePath];
    if (config) {
      args.push('-s', config);
    }
    args.push(containerName);
    return await this.#sendOrExec(args);
  }

  async start(containerName: string, options: TurfStartOptions = {}) {
    const args = ['start'];

    const ADDITIONAL_KEYS = ['seed', 'stdout', 'stderr'] as const;
    for (const key of ADDITIONAL_KEYS) {
      const val = options[key];
      if (val) {
        args.push(`--${key}`);
        args.push(val);
      }
    }

    args.push(containerName);

    return this.#sendOrExec(args);
  }

  async run(containerName: string, options: TurfRunOptions) {
    const args = ['run', '-b', options.bundlePath];

    const ADDITIONAL_KEYS = ['seed', 'stdout', 'stderr', 'config'] as const;
    for (const key of ADDITIONAL_KEYS) {
      const val = options[key];
      if (val) {
        args.push(`--${key}`);
        args.push(val);
      }
    }

    args.push(containerName);

    return this.#sendOrExec(args);
  }

  async stop(containerName: string, force: boolean) {
    const args = ['stop'];
    if (force) {
      args.push('--force');
    }
    args.push(containerName);
    try {
      await this.#send(args);
    } catch (e: any) {
      if (TurfStopIgnorableCodes.includes(e.code)) {
        return;
      }
      if (force && e.code === TurfCode.EAGAIN) {
        return;
      }
      throw e;
    }
  }

  async delete(containerName: string) {
    return this.#exec(['delete', containerName]);
  }

  /**
   * ps
   */
  async ps(): Promise<TurfProcess[]> {
    const ret = await this.#exec(['ps']);
    const lines = ret.split('\n').filter(l => l);
    if (!lines.length) return [];
    const arr = lines
      .map(line => {
        const match = TurfPsLineMatcher.exec(line);
        if (match == null) {
          return null;
        }
        const [, /** match */ name, pid, status] = match;
        return {
          status: TurfContainerStates[status] ?? TurfContainerStates.unknown,
          pid: Number.parseInt(pid),
          name,
        } as TurfProcess;
      })
      .filter(isNotNullish);

    return arr;
  }

  async state(name: string): Promise<TurfState> {
    const ret = await this.#exec(['state', name]);
    const lines = ret.split('\n').filter(l => l);
    if (!lines.length) {
      throw new Error(`Unable to state turf '${name}'`);
    }
    const obj = lines.reduce((obj, line) => {
      // Output format and semantics
      const match = TurfStateLineMatcher.exec(line);
      if (match == null) {
        return obj;
      }
      const [, /** match */ name, value] = match;
      if (
        name === 'pid' ||
        name.startsWith('stat.') ||
        name.startsWith('rusage.')
      ) {
        obj[name] = Number.parseInt(value);
      } else {
        obj[name] = value;
      }
      return obj;
    }, {} as Record<string, string | number>);
    obj.state = TurfContainerStates[obj.state] ?? TurfContainerStates.unknown;

    return obj as unknown as TurfState;
  }
}

export class TurfError extends Error {
  name = 'TurfError';
  constructor(public code: number, public args: string[]) {
    super(`Turf response with non-zero code(${code})`);
  }
}
