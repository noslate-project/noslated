import * as MidwayLogger from '@midwayjs/logger';
import loggers from '#self/lib/logger';

before(() => {
  loggers.setSink(loggers.getPrettySink(''));
});

after(() => {
  MidwayLogger.clearAllLoggers();
});
