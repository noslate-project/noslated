import { LoggerFactory } from '#self/lib/logger_factory';

export interface Injectable {
  ready?(): Promise<void>;
  close?(): Promise<void>;
}

export interface InjectableConstructor<T, Ctx> {
  new (ctx: Ctx): T;
}

export type Registry = {
  [key: string]: Injectable | object;
};

interface InstanceRecord {
  name: string;
  deps: string[];
  ready: boolean;
  readyFuture?: Promise<void>;
  /** undefined when the instance is being constructed */
  ins?: Injectable;
}

export type StringKeyOf<T> = keyof T & string;

const UnreachableConstructor: InjectableConstructor<any, any> = function () {
  throw new Error('unreachable');
} as any;

export class DependencyContext<
  R extends Registry,
  Impl extends DependencyContext<any, any> = any
> {
  private _reg = new Map<string, InjectableConstructor<Injectable, Impl>>();
  private _instances = new Map<string, InstanceRecord>();
  private _frozen = false;

  private _constructStack: string[][] = [];

  bind<K extends StringKeyOf<R>>(
    key: K,
    cons: InjectableConstructor<R[K], Impl>
  ) {
    if (this._frozen) {
      throw new Error('Dependency context is frozen.');
    }
    this._reg.set(key, cons);
  }

  bindInstance<K extends StringKeyOf<R>>(key: K, ins: R[K]) {
    if (this._frozen) {
      throw new Error('Dependency context is frozen.');
    }
    this._reg.set(key, UnreachableConstructor);
    this._instances.set(key, {
      name: key,
      deps: [],
      ready: false,
      ins,
    });
  }

  freeze() {
    this._frozen = true;
  }

  getInstance<K extends StringKeyOf<R>>(key: K): R[K] {
    let record = this._instances.get(key);
    if (record == null) {
      const Cons = this._reg.get(key);
      if (Cons == null) {
        throw new Error(
          `'${key}' is not recognizable in the dependency context.`
        );
      }
      const deps: string[] = [];
      record = {
        name: key,
        deps,
        ready: false,
      };
      this._instances.set(key, record);
      this._constructStack.push(deps);
      const ins = new Cons(this as unknown as Impl);
      this._constructStack.pop();
      record.ins = ins;
    }
    if (record.ins == null) {
      throw new Error(`Unexpected cyclic dependency on '${key}'.`);
    }
    this._constructStack[this._constructStack.length - 1]?.push(key);
    return record.ins as R[K];
  }

  async bootstrap() {
    await Promise.all(
      Array.from(this._reg.keys()).map(key => {
        this.getInstance(key);
        const record = this._instances.get(key)!;
        return this._bootstrapInstance(record);
      })
    );
  }

  private _bootstrapInstance(record: InstanceRecord): Promise<void> {
    if (record.ready) {
      return record.readyFuture!;
    }
    record.ready = true;
    record.readyFuture = Promise.all(
      record.deps.map(key => {
        let dep = this._instances.get(key);
        if (dep == null) {
          this.getInstance(key);
          dep = this._instances.get(key);
        }
        return this._bootstrapInstance(dep!);
      })
    ).then(async () => {
      await record.ins!.ready?.();
    });
    return record.readyFuture;
  }

  async dispose() {
    const list = Array.from(this._instances.values()).reverse();
    for (const { ins } of list) {
      await ins!.close?.();
    }
    LoggerFactory.close();
  }

  snapshot() {
    return Array.from(this._reg.keys()).map(key => {
      const record = this._instances.get(key);
      return {
        name: key,
        deps: record?.deps ?? [],
        instantiated: record?.ins != null,
      };
    });
  }
}
