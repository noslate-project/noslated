const getLogger = (filename) => {
  return {
    info: (message) => {
      console.info(`[${filename}] ${message}`);
    }
  }
};

class LoggerFactory {
  loggers = new Map();

  createLogger(filename) {
    const logger = getLogger(filename);
    this.loggers.set(filename, logger);
    return logger;
  }

  get(name) {
    return this.loggers.get(name);
  }

  close() {
    console.debug('close logger factory');
  }
}

module.exports = LoggerFactory;
