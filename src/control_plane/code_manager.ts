import { EventEmitter } from 'events';
import { promises as fs } from 'fs';
import path from 'path';
import util from 'util';

import loggers from '#self/lib/logger';
import * as naming from '#self/lib/naming';
import * as utils from '#self/lib/util';
import { ConfigContext } from './deps';
import { DependencyContext } from '#self/lib/dependency_context';

async function exists(filepath: string) {
  let exists = true;
  try {
    await fs.stat(filepath);
  } catch {
    exists = false;
  }
  return exists;
}

export class CodeManager extends EventEmitter {
  logger;
  map: Map<string, Promise<string> | boolean>;
  workDir: string;

  constructor(ctx: DependencyContext<ConfigContext>) {
    super();
    this.workDir = ctx.getInstance('config').dirs.noslatedWork;
    this.logger = loggers.get('code manager');

    this.map = new Map();
  }

  getBundleDir(name: string, url: string, signature: string) {
    return path.join(
      this.workDir,
      'bundles',
      naming.codeBundleName(name, signature, url)
    );
  }

  getHTTPCacheDir(url: string) {
    return path.join(
      this.workDir,
      'caches',
      url.replace(/[^0-9a-zA-Z_\-.]/g, '_')
    );
  }

  async ensureFromHTTP(url: string, bundlePath: string) {
    const cachePath = this.getHTTPCacheDir(url);
    const symbolLinkPath = path.join(bundlePath, 'code');

    let exists = true;
    try {
      await fs.stat(cachePath);
    } catch (e) {
      exists = false;
    }

    if (!exists) {
      await utils.downloadZipAndExtractToDir(url, cachePath);
    }

    // make symbol link
    await fs.mkdir(bundlePath, { recursive: true });
    await fs.symlink(cachePath, symbolLinkPath);
  }

  async ensureFromFileSystem(url: string, bundlePath: string) {
    const realCodeDir = url.substr('file://'.length);
    const symbolLinkPath = path.join(bundlePath, 'code');

    // check real code dir
    await fs.stat(realCodeDir);

    await fs.mkdir(bundlePath, { recursive: true });
    await fs.symlink(realCodeDir, symbolLinkPath);
  }

  async ensure(name: string, url: string, signature: string) {
    const bundlePath = this.getBundleDir(name, url, signature);

    const ret = this.map.get(bundlePath);

    // already exists in map
    if (ret !== undefined && ret !== false) {
      if (util.types.isPromise(ret)) {
        return ret;
      }

      return bundlePath;
    }

    const { resolve, reject, promise } = utils.createDeferred<string>();
    this.map.set(bundlePath, promise);

    const codeValid = await this.checkBundleIntegrity(url, bundlePath);
    // already exists in filesystem
    if (codeValid) {
      this.map.set(bundlePath, true);
      this.logger.info(`First ensure ${name} (${url}) with ${signature}.`);
      resolve(bundlePath);
      return promise;
    }

    switch (url.substr(0, 7)) {
      case 'https:/':
      case 'http://': {
        try {
          await this.ensureFromHTTP(url, bundlePath);
        } catch (e) {
          this.map.set(bundlePath, false);
          reject(e);
          return promise;
        }
        break;
      }

      case 'file://': {
        try {
          await this.ensureFromFileSystem(url, bundlePath);
        } catch (e) {
          this.map.set(bundlePath, false);
          reject(e);
          return promise;
        }
        break;
      }

      default: {
        process.nextTick(() => {
          this.map.set(bundlePath, false);
          reject(new Error(`invalid url ${url}`));
        });
        return promise;
      }
    }

    await this.generateBundleIntegritySigil(url, bundlePath);
    resolve(bundlePath);
    this.map.set(bundlePath, true);
    this.logger.info(`First ensure ${name} (${url}) with ${signature}.`);
    return promise;
  }

  private async generateBundleIntegritySigil(url: string, bundlePath: string) {
    if (url.startsWith('file://')) {
      return;
    }
    try {
      await fs.writeFile(path.join(bundlePath, '.integrity'), '', 'utf8');
    } catch (e) {
      this.logger.error('failed to write integrity sigil: %s', bundlePath, e);
      throw e;
    }
  }

  private async checkBundleIntegrity(url: string, bundlePath: string) {
    if (url.startsWith('file://')) {
      return exists(bundlePath);
    }
    return exists(path.join(bundlePath, '.integrity'));
  }
}
