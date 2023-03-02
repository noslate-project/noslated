import * as common from '#self/test/common';
import assert from 'assert';
import sinon from 'sinon';
import { Event, EventBus } from '../event-bus';

describe(common.testName(__filename), () => {
  class TestEvent extends Event {
    static type = 'bar';
    constructor() {
      super(TestEvent.type);
    }
  }
  class TestEvent2 extends Event {
    static type = 'foo';
    constructor() {
      super(TestEvent.type);
    }
  }

  it('should construct', () => {
    const eventBus = new EventBus([TestEvent2]);
    assert.deepStrictEqual(eventBus.events, ['foo']);
  });

  it('should throw on subscribing unknown events', () => {
    const eventBus = new EventBus([TestEvent2]);
    assert.throws(() => {
      eventBus.subscribe(TestEvent, { next() {} });
    }, /Event 'bar' is not recognizable/);
  });

  it('should publish and handle event', async () => {
    const eventBus = new EventBus([TestEvent]);

    const stub = sinon.stub();
    eventBus.subscribe(TestEvent, { next: stub });
    await eventBus.publish(new TestEvent());

    assert.strictEqual(stub.callCount, 1);
  });

  it('should reject when observer throws', async () => {
    const eventBus = new EventBus([TestEvent]);

    const stub = sinon.stub();
    stub.throws(new Error('foobar'));
    eventBus.subscribe(TestEvent, { next: stub });

    await assert.rejects(eventBus.publish(new TestEvent()), /foobar/);
    assert.strictEqual(stub.callCount, 1);
  });

  it('should reject when event type is unknown', async () => {
    const eventBus = new EventBus([TestEvent2]);
    await assert.rejects(
      eventBus.publish(new TestEvent()),
      /Event 'bar' is not recognizable/
    );
  });
});
