import assert from 'assert';
import * as common from '#self/test/common';
import {
  loggers,
  Logger,
  PrefixedLogger,
  DefaultSink,
  Loggers,
} from '#self/lib/loggers';
import * as sinon from 'sinon';
import { sleep } from '../util';
import { config } from '#self/config';
import { join } from 'path';
import { FIXTURES_DIR } from '#self/test/util';

describe(common.testName(__filename), () => {
  describe('default', () => {
    let spy: sinon.SinonSpy;

    beforeEach(() => {
      const sink = loggers.getSink();
      spy = sinon.spy(sink, 'info');
    });

    afterEach(() => {
      spy.restore();
    });

    after(async () => {
      // 等待 transports 输出完
      await sleep(100);
      loggers.close();
    });

    it('should get logger work', () => {
      const logger = loggers.get('helloworld');
      assert(logger instanceof Logger);
      assert(logger.category === 'HELLOWORLD');

      assert(loggers['_loggers'].has('HELLOWORLD'));
      assert.strictEqual(loggers['_loggers'].get('HELLOWORLD'), logger);
    });

    it('should get exists logger', () => {
      const logger = loggers.get('helloworld');
      const logger2 = loggers.get('helloworld');

      assert.strictEqual(logger, logger2);
    });

    it('should logger log with category', () => {
      const logger = loggers.get('helloworld');
      logger.info('foobar');

      assert(spy.calledWithMatch('[HELLOWORLD] foobar'));

      logger.info('count %d', 10);

      assert(spy.calledWithMatch('[HELLOWORLD] count %d', 10));
    });

    it('should prefixed logger log with category and prefix', () => {
      const prefixLogger = new PrefixedLogger('helloworld', 'prefix');

      prefixLogger.info('foobar');

      assert(spy.calledWithMatch('[HELLOWORLD] [prefix] foobar'));

      prefixLogger.info('count %d', 10);

      assert(spy.calledWithMatch('[HELLOWORLD] [prefix] count %d', 10));
    });

    it('should set sink', () => {
      const spyInfo = sinon.spy();

      const sink = {
        info: spyInfo,
        warn: () => {},
        error: () => {},
        debug: () => {},
        write: () => {},
      };

      loggers.setSink(sink);

      const logger = loggers.get('helloworld');
      logger.info('foobar');

      assert(spyInfo.calledWithMatch('[HELLOWORLD] foobar'));

      loggers.setSink(DefaultSink);
    });

    it('should avoid call sink methods with filtered level', () => {
      const spyInfo = sinon.spy();
      const spyError = sinon.spy();

      const sink = {
        info: spyInfo,
        warn: () => {},
        error: spyError,
        debug: () => {},
        write: () => {},
      };

      loggers.setSink(sink, 'error');

      const logger = loggers.get('helloworld');
      logger.info('foobar');
      logger.error('error');

      assert(spyInfo.notCalled);
      assert(spyError.calledWithMatch('[HELLOWORLD] error'));

      loggers.setSink(DefaultSink);
    });

    it('should get pretty sink', () => {
      const sink = Loggers.getPrettySink('other');
      const logger = Loggers.loggerFactory.get('other');

      assert.strictEqual(logger, sink);
    });
  });

  describe('custom logger factory', () => {
    let stubConfig: sinon.SinonStub;
    let spyConsoleInfo: sinon.SinonSpy;

    before(() => {
      stubConfig = sinon.stub(config, 'logger').value({
        customFactoryPath: join(FIXTURES_DIR, 'logger_factory/index.js'),
        level: 'debug',
      });
    });

    beforeEach(() => {
      spyConsoleInfo = sinon.spy(console, 'info');
    });

    afterEach(() => {
      spyConsoleInfo.restore();
    });

    after(() => {
      stubConfig.restore();
      // 还原状态
      Loggers.loggerFactory = Loggers.createLoggerFactory();
      const sink = Loggers.getPrettySink('');
      loggers.setSink(sink);
    });

    it('should use custom logger factory', () => {
      Loggers.loggerFactory = Loggers.createLoggerFactory();

      const sink = Loggers.getPrettySink('other');

      sink.info('foobar');

      assert(spyConsoleInfo.calledWithMatch('[other] foobar'));

      loggers.setSink(sink);

      const logger = loggers.get('helloworld');
      logger.info('foobar');

      assert(spyConsoleInfo.calledWithMatch('[other] [HELLOWORLD] foobar'));

      const spyDebug = sinon.spy(console, 'debug');

      loggers.close();

      assert(spyDebug.calledWithMatch('close logger factory'));

      spyDebug.restore();
    });
  });
});
