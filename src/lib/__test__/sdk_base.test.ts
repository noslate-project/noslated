import assert from 'assert';
import { EventEmitter } from 'events';
import { Base, BaseOf } from '#self/lib/sdk_base';
import * as common from '#self/test/common';

describe(common.testName(__filename), () => {
  it('Base ready & close', async () => {
    class Foo extends Base {
      initCount = 0;
      closeCount = 0;
      async _init() {
        this.initCount++;
      }
      async _close() {
        this.closeCount++;
      }
    }

    const foo = new Foo();
    await foo.ready();
    await foo.ready();
    assert.strictEqual(foo.initCount, 1);
    assert(foo.isReady);
    assert(!foo.isClosed);

    await foo.close();
    await foo.close();
    assert.strictEqual(foo.closeCount, 1);
    assert(!foo.isReady);
    assert(foo.isClosed);
  });

  it('Base ready errors', async () => {
    class Foo extends Base {
      async _init() {
        throw new Error('foo');
      }
    }

    const foo = new Foo();
    await assert.rejects(foo.ready(), /foo/);
    await assert.rejects(foo.ready(), /foo/);
    assert(!foo.isReady);
    assert(!foo.isClosed);

    await foo.close();
    assert(!foo.isReady);
    assert(foo.isClosed);
  });

  it('Base close errors', async () => {
    class Foo extends Base {
      async _init() { /** empty */ }
      async _close() {
        throw new Error('foo');
      }
    }

    const foo = new Foo();
    await foo.ready();
    assert(foo.isReady);
    assert(!foo.isClosed);

    await assert.rejects(foo.close(), /foo/);
    assert(!foo.isReady);
    assert(foo.isClosed);
  });

  it('BaseOf creates an inheritance hierarchy from base class', async () => {
    class Foo extends BaseOf(EventEmitter) {
      initCount = 0;
      closeCount = 0;
      async _init() {
        this.initCount++;
      }
      async _close() {
        this.closeCount++;
      }
    }
    const foo = new Foo();
    assert(foo.on === EventEmitter.prototype.on);

    await foo.ready();
    await foo.ready();
    assert.strictEqual(foo.initCount, 1);
    assert(foo.isReady);
    assert(!foo.isClosed);

    await foo.close();
    await foo.close();
    assert.strictEqual(foo.closeCount, 1);
    assert(!foo.isReady);
    assert(foo.isClosed);
  });
});
