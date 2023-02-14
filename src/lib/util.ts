import { EventEmitter, Readable } from 'stream';
import cp from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { DefaultSerializer, DefaultDeserializer } from 'v8';
import download from 'download';
import crypto from 'crypto';
import loggers from './logger';
import { Clock, systemClock } from './clock';

export {
  tryQ,
  createDeferred,
  bufferFromStream,
  downloadZipAndExtractToDir,
  raceEvent,
  getCurrentPlaneId,
  structuredClone,
  jsonClone,
};

/**
 * try? fn()
 * @param fn the function
 */
function tryQ<T = unknown>(fn: () => T) {
  try {
    return fn();
  } catch (e) {
    return null;
  }
}

export function isNotNullish<T>(it: T | null | undefined): it is T {
  return it != null;
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((_resolve, _reject) => {
    resolve = _resolve;
    reject = _reject;
  });
  return { promise, resolve, reject };
}

export function sleep(ms: number, clock: Clock = systemClock): Promise<void> {
  const deferred = createDeferred<void>();
  clock.setTimeout(() => {
    deferred.resolve();
  }, ms);
  return deferred.promise;
}

async function bufferFromStream(readable: Readable) {
  const chunks = [];
  let totalLength = 0;
  for await (const chunk of readable) {
    chunks.push(chunk);
    totalLength += chunk.byteLength;
  }
  return Buffer.concat(chunks, totalLength);
}

async function downloadZipAndExtractToDir(url: string, dir: string) {
  const { resolve, reject, promise } = createDeferred();
  const logger = loggers.get('lib/util#downloadZipAndExtractToDir');

  const zipFilename = `${crypto.randomUUID()}.zip`;

  logger.info(`downloading code ${url} to ${zipFilename}...`);
  await download(url, os.tmpdir(), {
    filename: zipFilename,
  });

  logger.info(`extracting code ${zipFilename} to ${dir}...`);
  let responed = false;
  await fs.mkdir(path.dirname(dir), { recursive: true });

  const zipOrig = path.join(os.tmpdir(), zipFilename);
  const unzip = cp.spawn('unzip', ['-q', zipOrig, '-d', dir], {
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  unzip.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  unzip.on('close', async () => {
    if (responed) return;
    responed = true;

    fs.unlink(zipOrig).catch(e => {
      logger.warn(e);
    });

    let stat;
    try {
      stat = await fs.stat(dir);
    } catch (e) {
      return reject(new Error(stderr));
    }

    if (!stat.isDirectory()) {
      return reject(new Error(`${dir} unzip failed.`));
    }

    logger.info(`${dir} extracted.`);
    resolve(dir);
  });

  unzip.on('error', err => {
    /* istanbul ignore next */
    if (responed) return;
    responed = true;
    unzip.kill('SIGKILL');
    fs.unlink(zipOrig).catch(e => {
      logger.warn(e);
    });
    reject(err);
  });

  return promise;
}

function raceEvent(eventEmitter: EventEmitter, events: string[]) {
  const deferred = createDeferred<[string, any[]]>();
  const off: () => void = () => {
    events.forEach((it, idx) => {
      eventEmitter.off(it, callbacks[idx]);
    });
  };
  const callbacks = events.map(it => {
    return (...args: unknown[]) => {
      off();
      deferred.resolve([it, args]);
    };
  });

  events.forEach((it, idx) => {
    eventEmitter.once(it, callbacks[idx]);
  });

  (deferred.promise as any).off = off;
  return {
    promise: deferred.promise,
    off: off,
  };
}

function getCurrentPlaneId() {
  return Number.parseInt(process.env.NOSLATED_PLANE_ID ?? '0') || 0;
}

function structuredClone(value: unknown) {
  const ser = new DefaultSerializer();
  ser.writeValue(value);
  const serialized = ser.releaseBuffer();

  const des = new DefaultDeserializer(serialized);
  return des.readValue();
}

function jsonClone(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

type MaybeNull<T> = T | null;
export type NotNullRecord<T> = T extends object
  ? {
      [Property in keyof T]: T[Property] extends MaybeNull<infer R>
        ? NotNullRecord<R>
        : NotNullRecord<T[Property]>;
    }
  : T;

type MaybeNill<T> = T | null | undefined;
export type DeepRequired<T> = T extends object
  ? Required<{
      [Property in keyof T]: T[Property] extends MaybeNill<infer R>
        ? DeepRequired<R>
        : DeepRequired<T[Property]>;
    }>
  : T;

declare global {
  interface Error {
    code?: number | string | null;
    // FIXME(chengzhong.wcz): https://github.com/microsoft/TypeScript/pull/47020#discussion_r906941103
    cause?: unknown;
  }
}
export function castError(e: unknown): Error {
  if (e == null) {
    return new Error(`${e}`);
  }
  if (typeof (e as any).message !== 'string') {
    return new Error((e as any).toString());
  }
  if (typeof (e as any).name !== 'string') {
    return new Error((e as any).toString());
  }
  return e as unknown as Error;
}

export function setDifference<T>(setA: Set<T>, setB: Set<T>): Set<T> {
  const _difference = new Set(setA);

  for (const elem of setB) {
    _difference.delete(elem);
  }

  return _difference;
}

export class BackoffCounter {
  private count = 0;
  constructor(
    private initialTimeout: number,
    private maxReconnectTimeout: number,
    private reconnectTimeout: number = Math.floor(
      (maxReconnectTimeout - initialTimeout) / 10
    )
  ) {}

  next() {
    const count = this.count++;
    if (count === 0) {
      return this.initialTimeout;
    }
    return Math.min(
      count * this.reconnectTimeout + this.initialTimeout,
      this.maxReconnectTimeout
    );
  }

  reset() {
    this.count = 0;
  }
}
