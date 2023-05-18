import * as common from '#self/test/common';
import assert from 'assert';
import { List } from '../list';

describe(common.testName(__filename), () => {
  it('should construct', () => {
    const list = new List<number>();
    list.push(0);
    list.push(1);
    list.push(2);
    assert.strictEqual(list.length, 3);
    assert.deepStrictEqual(Array.from(list.values()), [0, 1, 2]);
    assert.strictEqual(String(list), '0,1,2');
    assert.strictEqual(JSON.stringify(list), '[0,1,2]');
  });

  it('should get value', () => {
    const list = new List<number>();
    list.push(0);
    list.push(1);
    list.push(2);

    const tests = [
      [0, 0],
      [1, 1],
      [2, 2],
      [3, undefined],
      [-1, 2],
      [-2, 1],
      [-3, 0],
      [-4, undefined],
    ] as const;
    for (const [idx, it] of tests.entries()) {
      assert.strictEqual(list.at(it[0]), it[1], `${idx}`);
    }
  });

  it('modifications', () => {
    const list = new List<number>();
    list.push(1);
    list.push(2);
    list.unshift(0);
    list.push(3);
    list.unshift(-1);
    list.push(4);
    list.shift();

    assert.strictEqual(list.length, 5);
    assert.deepStrictEqual(Array.from(list.values()), [0, 1, 2, 3, 4]);

    {
      list.remove(list.nodeAt(0)!);
      assert.strictEqual(list.length, 4);
      assert.deepStrictEqual(Array.from(list.values()), [1, 2, 3, 4]);
    }

    {
      list.remove(list.nodeAt(-1)!);
      assert.strictEqual(list.length, 3);
      assert.deepStrictEqual(Array.from(list.values()), [1, 2, 3]);
    }

    {
      list.remove(list.nodeAt(-2)!);
      assert.strictEqual(list.length, 2);
      assert.deepStrictEqual(Array.from(list.values()), [1, 3]);
    }
    list.remove(list.nodeAt(0)!);
    list.shift();
    assert.strictEqual(list.length, 0);
    assert.deepStrictEqual(Array.from(list.values()), []);
  });

  it('should ignore removed nodes', () => {
    const list = new List<number>();
    const node = list.push(1);
    assert.strictEqual(list.length, 1);

    list.remove(node);
    assert.strictEqual(list.length, 0);

    // Remove the node again.
    list.remove(node);
    assert.strictEqual(list.length, 0);
  });
});
