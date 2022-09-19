import assert from 'assert';
import { Loggers, Logger, levels, noopSink, Sink } from '#self/lib/loggers';
import { LoggerLevel } from '@midwayjs/logger';

describe('test/lib/logger.test.js', () => {
  it('should get logger', () => {
    const loggers = new Loggers();
    const logger = loggers.get('helloworld');
    assert(logger instanceof Logger);
    assert(logger.category === 'HELLOWORLD');

    assert(loggers.loggers.has('HELLOWORLD'));
    assert.strictEqual(loggers.loggers.get('HELLOWORLD'), logger);

    loggers.loggers.delete('HELLOWORLD');
  });

  it('should get exists logger', () => {
    const loggers = new Loggers();
    const logger = loggers.get('helloworld');
    const logger2 = loggers.get('helloworld');

    assert.strictEqual(logger, logger2);
    assert.strictEqual(loggers.loggers.get('HELLOWORLD'), logger);

    loggers.loggers.delete('HELLOWORLD');
  });

  it('should set sink', () => {
    const loggers = new Loggers();

    const tracker = new assert.CallTracker();
    const someSink = (() => {
      const log = (lvl: LoggerLevel, ...msg: any[]) => {
        console.log(`SOME-SINK [${lvl}] ${msg[0]}`, ...msg.slice(1));
      };
      const logger = {};
      for (const lvl of levels) {
        logger[lvl] = tracker.calls(log.bind(lvl), 1);
      }
      return logger;
    })();

    const logger = loggers.get('helloworld');
    for (const lvl of levels) {
      logger[lvl]('foobar');
    }

    loggers.setSink(someSink as Sink);
    for (const lvl of levels) {
      logger[lvl]('foobar');
    }

    loggers.setSink(noopSink);
    for (const lvl of levels) {
      logger[lvl]('foobar');
    }

    tracker.verify();
  });
});
