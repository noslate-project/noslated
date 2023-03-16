import * as common from '#self/test/common';
import { Queue } from '#self/lib/queue';
import assert from 'assert';

describe(common.testName(__filename), () => {
  const clock = common.createTestClock();

  it('should drain tasks', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        result.push(item);
      },
      {
        clock,
      }
    );

    taskQueue.enqueue(1);
    taskQueue.enqueue(2);
    await taskQueue.enqueue(3);

    assert.deepStrictEqual(result, [1, 2, 3]);
  });

  it('should drain tasks with rejections', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        if (item === 2) {
          throw new Error('foobar');
        }
        result.push(item);
      },
      {
        clock,
      }
    );

    taskQueue.enqueue(1);
    let p2 = taskQueue.enqueue(2);
    p2 = assert.rejects(p2, /foobar/);

    const p3 = taskQueue.enqueue(3);

    await p2;
    await p3;
    assert.deepStrictEqual(result, [1, 3]);
  });

  it('should drain tasks with delay', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        result.push(item);
      },
      {
        delay: 5,
        clock,
      }
    );

    taskQueue.enqueue(1);
    taskQueue.enqueue(2);

    await clock.tickAsync(1);
    assert.deepStrictEqual(result, []);
    taskQueue.enqueue(3);

    await clock.tickAsync(4);
    assert.deepStrictEqual(result, [1, 2]);

    await clock.tickAsync(5);
    assert.deepStrictEqual(result, [1, 2, 3]);

    taskQueue.enqueue(4);
    await clock.tickAsync(5);
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });

  it('should drain tasks when queue item count reached high water mark', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        result.push(item);
      },
      {
        delay: 5,
        highWaterMark: 3,
        clock,
      }
    );

    taskQueue.enqueue(1);
    taskQueue.enqueue(2);
    taskQueue.enqueue(3);
    taskQueue.enqueue(4);
    taskQueue.enqueue(5);

    await clock.tickAsync(1);
    assert.deepStrictEqual(result, [1, 2]);

    taskQueue.enqueue(6);
    await clock.tickAsync(1);
    assert.deepStrictEqual(result, [1, 2, 3]);

    await clock.tickAsync(5);
    assert.deepStrictEqual(result, [1, 2, 3, 4, 5, 6]);
  });

  it('should abort task with abortsignal', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        result.push(item);
      },
      {
        clock,
      }
    );

    const abortController = new AbortController();

    let p1 = taskQueue.enqueue(1, { abortSignal: abortController.signal });
    p1 = assert.rejects(p1, { name: 'AbortError' });

    taskQueue.enqueue(2);
    const p3 = taskQueue.enqueue(3);

    abortController.abort();
    await p1;
    await p3;
    assert.deepStrictEqual(result, [2, 3]);
  });

  it('should abort tasks when queue is closed', async () => {
    const result: number[] = [];
    const taskQueue = new Queue<number>(
      async item => {
        result.push(item);
      },
      {
        clock,
      }
    );

    const abortController = new AbortController();

    let p1 = taskQueue.enqueue(1, { abortSignal: abortController.signal });
    p1 = assert.rejects(p1, { name: 'AbortError' });

    taskQueue.close();
    await p1;
    assert.deepStrictEqual(result, []);
  });
});
