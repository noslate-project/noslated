import assert from 'assert';
import { createDeferred, Deferred } from './util';
import { Guest } from './rpc/guest';

const baseMaps: WeakMap<Constructor, BaseConstructor<IBase> & any> =
  new WeakMap();

/**
 * Derived from https://github.com/node-modules/sdk-base
 */
export function BaseOf<TBase extends Constructor>(
  BaseClass: TBase
): BaseConstructor<IBase> & TBase {
  if (baseMaps.has(BaseClass)) {
    return baseMaps.get(BaseClass)!;
  }

  class Base extends BaseClass implements IBase {
    #ready = false;
    #readyDeferred = createDeferred<void>();
    #closed = false;
    #closeDeferred: Deferred<void> | null;

    constructor(...args: any[]) {
      super(...args);
      this.#closeDeferred = null;

      process.nextTick(() => {
        this.#start();
      });
    }

    #start() {
      assert(
        typeof this._init === 'function',
        '[sdk-base] this._init should be a function.'
      );
      Promise.resolve()
        .then(() => this._init())
        .then(
          () => {
            this.#ready = true;
            this.#readyDeferred.resolve();
          },
          err => {
            this.#readyDeferred.reject(err);
          }
        );
    }

    get isReady(): boolean {
      return this.#ready;
    }

    get isClosed(): boolean {
      return this.#closed;
    }

    ready(): Promise<void> {
      return this.#readyDeferred.promise;
    }

    close() {
      if (this.#closeDeferred) {
        return this.#closeDeferred.promise;
      }
      this.#closeDeferred = createDeferred<void>();
      Promise.resolve()
        .then(() => this._close())
        .then(
          () => {
            this.#closed = true;
            this.#ready = false;
            this.#closeDeferred?.resolve();
          },
          err => {
            this.#closed = true;
            this.#ready = false;
            this.#closeDeferred?.reject(err);
          }
        );

      return this.#closeDeferred.promise;
    }

    /**
     * @protected
     */
    async _init() {
      /** empty */
    }
    /**
     * @protected
     */
    async _close() {
      /** empty */
    }
  }

  baseMaps.set(BaseClass, Base);

  return Base;
}

class EmptyClass {}
export const Base = BaseOf(EmptyClass);

type Constructor = new (...args: any[]) => any;

type BaseConstructor<T = unknown> = new (...args: any[]) => T;

export interface IBase {
  get isReady(): boolean;
  get isClosed(): boolean;
  ready(): Promise<void>;
  close(): Promise<void>;
}

export interface BaseOfGuest<T1, T2 = T1, T3 = T2> {
  new (...args: ConstructorParameters<any>): IBase & Guest & T1 & T2 & T3;
}
