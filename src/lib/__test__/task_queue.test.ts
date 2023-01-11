import * as common from '#self/test/common';
import { Priority, TaskQueue } from '#self/lib/task_queue';
import assert from 'assert';

describe(common.testName(__filename), () => {
  const compare = (lhs: number, rhs: number) => {
    return lhs - rhs;
  };
  const clock = common.createTestClock();

  it('should drain tasks', async () => {
    const result: number[] = [];
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
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
    const taskQueue = new TaskQueue(
      async item => {
        if (item === 2) {
          throw new Error('foobar');
        }
        result.push(item);
      },
      {
        compare,
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

  it('should drain tasks with priority', async () => {
    const result: number[] = [];
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
        clock,
      }
    );

    const p3 = taskQueue.enqueue(3, { priority: Priority.kLow });
    taskQueue.enqueue(2, { priority: Priority.kNormal });
    taskQueue.enqueue(1, { priority: Priority.kHigh });

    await p3;
    assert.deepStrictEqual(result, [1, 2, 3]);
  });

  it('should drain tasks with delay', async () => {
    const result: number[] = [];
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
        clock,
      }
    );

    const p4 = taskQueue.enqueue(4, { delay: 4 });
    const p3 = taskQueue.enqueue(3, { delay: 1 });
    taskQueue.enqueue(1, { delay: 0 });
    const p2 = taskQueue.enqueue(2, { delay: 0 });

    await p2;
    assert.deepStrictEqual(result, [1, 2]);

    await clock.tickAsync(1);
    await p3;
    assert.deepStrictEqual(result, [1, 2, 3]);

    await clock.tickAsync(1);
    assert.deepStrictEqual(result, [1, 2, 3]);

    await clock.tickAsync(3);
    await p4;
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });

  it('should drain tasks with delay and priority', async () => {
    const result: number[] = [];
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
        clock,
      }
    );

    taskQueue.enqueue(2, { delay: 20 });
    taskQueue.enqueue(3, { delay: 30 });

    await clock.tickAsync(10);
    const p1 = taskQueue.enqueue(1, { delay: 10, priority: Priority.kHigh });

    await clock.tickAsync(10);
    await p1;
    assert.deepStrictEqual(result, [1, 2]);

    const p4 = taskQueue.enqueue(4, { delay: 10, priority: Priority.kLow });
    await clock.tickAsync(10);
    await p4;
    assert.deepStrictEqual(result, [1, 2, 3, 4]);
  });

  it('should abort task with abortsignal', async () => {
    const result: number[] = [];
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
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
    const taskQueue = new TaskQueue(
      async item => {
        result.push(item);
      },
      {
        compare,
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
