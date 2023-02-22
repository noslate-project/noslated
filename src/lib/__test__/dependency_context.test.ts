import * as common from '#self/test/common';
import assert from 'assert';
import { DependencyContext } from '../dependency_context';
import { createDeferred } from '../util';

describe(common.testName(__filename), () => {
  class Foo {
    isReady = false;
    isClosed = false;
    constructor() {}

    ready() {
      const deferred = createDeferred<void>();
      setImmediate(() => {
        this.isReady = true;
        deferred.resolve();
      });
      return deferred.promise;
    }

    close() {
      this.isClosed = true;
    }
  }
  class Bar {
    isReady = false;
    isClosed = false;
    foo: Foo;
    constructor(ctx: DependencyContext<TestContext>) {
      this.foo = ctx.getInstance('foo');
    }

    ready() {
      assert.ok(this.foo.isReady);
      this.isReady = true;
    }

    close() {
      assert.ok(!this.foo.isClosed);
      this.isClosed = true;
    }
  }
  class CycleA {
    b: CycleB;
    constructor(ctx: DependencyContext<TestContext>) {
      this.b = ctx.getInstance('cycleB');
    }
  }
  class CycleB {
    a: CycleA;
    constructor(ctx: DependencyContext<TestContext>) {
      this.a = ctx.getInstance('cycleA');
    }
  }
  type TestContext = {
    foo: Foo;
    bar: Bar;
    cycleA: CycleA;
    cycleB: CycleB;
  };

  describe('setup context', () => {
    it('should bind', () => {
      const ctx = new DependencyContext<TestContext>();
      ctx.bindInstance('foo', new Foo());
      ctx.bind('bar', Bar);
    });

    it('should get with dependencies', () => {
      const ctx = new DependencyContext<TestContext>();
      const foo = new Foo();
      ctx.bindInstance('foo', foo);
      ctx.bind('bar', Bar);

      const bar = ctx.getInstance('bar');
      assert.strictEqual(bar.foo, foo);
    });

    it('should get with dependencies', () => {
      const ctx = new DependencyContext<TestContext>();
      const foo = new Foo();
      ctx.bindInstance('foo', foo);
      ctx.bind('bar', Bar);

      const bar = ctx.getInstance('bar');
      assert.strictEqual(bar.foo, foo);
      assert.deepStrictEqual(ctx.snapshot(), [
        {
          name: 'foo',
          deps: [],
          instantiated: true,
        },
        {
          name: 'bar',
          deps: ['foo'],
          instantiated: true,
        },
      ]);
    });

    it('should abort with cyclic dependencies', () => {
      const ctx = new DependencyContext<TestContext>();
      ctx.bind('cycleA', CycleA);
      ctx.bind('cycleB', CycleB);

      assert.throws(() => {
        ctx.getInstance('cycleA');
      }, /Unexpected cyclic dependency on 'cycleA'/);
    });

    it('should bootstrap with dependencies', async () => {
      const ctx = new DependencyContext<TestContext>();
      const foo = new Foo();
      ctx.bind('bar', Bar);
      ctx.bindInstance('foo', foo);

      await ctx.bootstrap();
      const bar = ctx.getInstance('bar');
      assert.ok(bar.isReady);
    });

    it('should close instances in reversed bind order', async () => {
      const ctx = new DependencyContext<TestContext>();
      const foo = new Foo();
      ctx.bindInstance('foo', foo);
      ctx.bind('bar', Bar);

      await ctx.bootstrap();
      const bar = ctx.getInstance('bar');

      await ctx.dispose();
      assert.ok(bar.isClosed);
    });
  });
});
