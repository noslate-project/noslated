import { config } from '#self/config';
import iterator from '#self/lib/iterator';
import { EventEmitter } from 'events';
import { LoggerFactory } from '#self/lib/logger_factory';

const logger = LoggerFactory.prefix('delegate resource');
const kExclusive = 'ex';
const kShared = 'sh';
const kTimeout = config.delegate.resourceAcquisitionTimeout;

let id = 0;
function nextId() {
  if (id === Number.MAX_SAFE_INTEGER) {
    id = 0;
  }
  return id++;
}

class ResourceStub extends EventEmitter {
  _resourceId;
  _exclusive = false;
  _activeTokens = new Set<string>();
  _timer: ReturnType<typeof setTimeout> | null = null;
  _waitList = new Set<string>();

  constructor(resourceId: string) {
    super();
    this._resourceId = resourceId;
  }

  get activeTokens() {
    return Array.from(this._activeTokens);
  }

  get isActive() {
    return this._activeTokens.size > 0;
  }

  get exclusive() {
    return this._exclusive;
  }

  acquire(exclusive: boolean, credential: string) {
    const token = `${
      exclusive ? kExclusive : kShared
    }:${nextId()}:${credential}`;
    const acquired = this._tryAcquire(token, exclusive);
    if (!acquired) {
      this._waitList.add(token);
    }
    return { token, acquired };
  }

  /**
   * Release for single token.
   */
  release(token: string) {
    this._waitList.delete(token);
    if (!this._activeTokens.has(token)) {
      return;
    }
    this._activeTokens.delete(token);
    this._next();
  }

  /**
   * Batch release.
   */
  cleanup(tokens: string[]) {
    let activeChanged = false;
    for (const token of tokens) {
      this._waitList.delete(token);
      if (!this._activeTokens.has(token)) {
        return;
      }
      this._activeTokens.delete(token);
      activeChanged = true;
    }
    if (activeChanged) {
      this._next();
    }
  }

  /**
   * Try acquire for single token
   */
  _tryAcquire(token: string, exclusive: boolean) {
    // If current is exclusive, don't add any tokens.
    if (exclusive && this._activeTokens.size > 0) {
      return false;
    }
    if (this._exclusive) {
      return false;
    }
    // If next token is an exclusive acquisition, don't add any new shared tokens anymore.
    if (!exclusive && !this._exclusive && this._peekExclusiveness()) {
      return false;
    }
    this._activeTokens.add(token);
    this._exclusive = exclusive;

    // Reset timer;
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = setTimeout(() => {
      this._onTimeout();
    }, kTimeout);

    return true;
  }

  /**
   * Try batch iteration.
   */
  _next() {
    // Active tokens changed. Exclusiveness must have been reset.
    this._exclusive = false;
    const newAcquiredTokens = [];
    while (this._waitList.size > 0) {
      const next = iterator.first(this._waitList.values())!;
      const exclusive = isExclusiveToken(next);
      // If current is exclusive, don't add any tokens.
      if (exclusive && this._activeTokens.size > 0) {
        break;
      }
      if (this._exclusive) {
        break;
      }
      newAcquiredTokens.push(next);
      this._activeTokens.add(next);
      this._exclusive = exclusive;
      this._waitList.delete(next);
    }

    // Reset timer;
    if (this._timer) {
      clearTimeout(this._timer);
    }
    this._timer = null;
    if (newAcquiredTokens.length > 0) {
      this._timer = setTimeout(() => {
        this._onTimeout();
      }, kTimeout);
      this.emit(
        'notification',
        newAcquiredTokens.map(it => [it, getCredentialFromToken(it)])
      );
    }

    if (this._activeTokens.size === 0 && this._waitList.size === 0) {
      this.emit('end');
    }
  }

  /**
   * Current resource acquisition timed out. Trigger batch iteration.
   */
  _onTimeout() {
    logger.info(
      'Resource acquisition time out for resource(%s)',
      this._resourceId
    );
    this._timer = null;
    this.emit(
      'timeout',
      Array.from(this._activeTokens).map(it => [it, getCredentialFromToken(it)])
    );
    this._activeTokens = new Set();
    this._next();
  }

  _peekExclusiveness() {
    const next = iterator.first(this._waitList.values());
    if (next == null) {
      return false;
    }
    return isExclusiveToken(next);
  }
}

function isExclusiveToken(token: string) {
  return token.startsWith(kExclusive);
}

function getCredentialFromToken(token: string) {
  return token.split(':', 3)[2];
}

export { ResourceStub };
