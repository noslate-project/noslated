import { Loggers, loggers } from '#self/lib/loggers';

before(() => {
  loggers.setSink(Loggers.getPrettySink(''));
});
