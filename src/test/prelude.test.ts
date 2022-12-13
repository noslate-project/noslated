import loggers from '#self/lib/logger';

before(() => {
  loggers.setSink(loggers.getPrettySink(''));
});
