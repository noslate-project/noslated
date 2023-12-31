import { LoggerFactory } from '#self/lib/logger_factory';

before(() => {
  LoggerFactory.init('');
});

after(() => {
  LoggerFactory.close();
});
