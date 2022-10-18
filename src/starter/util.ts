import { NoslatedClient, CanonicalCode } from '../delegate/noslated_ipc';

const levels = [ 'debug', 'info', 'error' ] as const;
type LogMethod = (...args: unknown[]) => void;
class NaiveLogger {
  #level;
  constructor(level = 'error') {
    this.#level = levels.indexOf(level as any);
    for (const [ idx, lvl ] of levels.entries()) {
      const upperLvl = lvl.toUpperCase();
      this[lvl] = (format, ...args) => {
        if (this.#level > idx) {
          return;
        }
        console[lvl]('WORKER [%s] %s - ' + format, upperLvl, new Date(), ...args);
      };
    }
  }

  debug!: LogMethod;
  info!: LogMethod;
  error!: LogMethod;
}

function safeError(error: unknown) {
  if (error == null) {
    return null;
  }
  try {
    return {
      message: String((error as any).message || error),
      stack: String((error as any).stack),
    };
  } catch {
    return {
      message: 'Internal Error (Unable to serialize error info)',
      stack: '',
    };
  }
}

export {
  NaiveLogger,
  safeError,
  NoslatedClient,
  CanonicalCode,
};
