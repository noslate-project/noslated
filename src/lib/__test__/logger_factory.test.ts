import * as common from '#self/test/common';
import assert from 'assert';
import { LoggerFactory } from '#self/lib/logger_factory';
import { ILogger, MidwayLogger, loggers } from '@midwayjs/logger';
import Sinon, * as sinon from 'sinon';

describe(common.testName(__filename), () => {
  afterEach(() => {
    LoggerFactory.close();
  });

  describe('default', () => {
    let spy: Sinon.SinonSpy;

    afterEach(() => {
      spy.resetHistory();
    });

    it('should init logger factory', () => {
      LoggerFactory.init('logger_factory_test.log');
      const logger = loggers.get('logger_factory_test.log');

      spy = sinon.spy(logger as MidwayLogger, 'transit');

      assert(logger);
    });

    it('should get prefixed logger work', () => {
      const logger = LoggerFactory.prefix('mock');

      logger.info('hello world');

      assert(spy.calledWithMatch('info', {}, '[MOCK] hello world'));
    });

    it('should get same prefixed logger when prefix duplicated', () => {
      const logger1 = LoggerFactory.prefix('mock');
      const logger2 = LoggerFactory.prefix('mock');

      assert.strictEqual(logger1, logger2);
    });
  });

  describe('custom sink', () => {
    it('should use custom sink', () => {
      const spy = sinon.spy();
      const sink = {
        info: spy,
      } as unknown as ILogger;

      LoggerFactory.init('logger_factory_test.log', sink);

      const logger = LoggerFactory.prefix('custom');

      logger.info('hello world');

      assert(spy.calledWith('[CUSTOM] hello world'));
    });
  });

  describe('create', () => {
    it('should create sink logger work', () => {
      LoggerFactory.init('logger_factory_test.log');

      const logger = LoggerFactory.create('mock');

      assert.strictEqual(logger, loggers.get('mock'));
    });

    it('should get same logger when name duplicated', () => {
      const logger = LoggerFactory.create('logger_factory_test.log');

      assert.strictEqual(logger, loggers.get('logger_factory_test.log'));
    });
  });
});
