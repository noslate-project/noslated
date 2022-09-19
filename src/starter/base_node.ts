import path from 'path';
import { ENV } from './generated';
import { NaiveLogger } from './util';
import type { Context } from './dapr';
import type { IncomingMessage, ServerResponse } from './request_response';

const WORKER_CREDENTIAL = process.env[ENV.WORKER_CREDENTIAL_KEY]!;

const CODE_PATH = process.env[ENV.CODE_PATH_KEY]!;
const IPC_PATH = process.env[ENV.IPC_PATH_KEY]!;
const HANDLER = process.env[ENV.FUNC_HANDLER_KEY]!;
const INITIALIZER = process.env[ENV.FUNC_INITIALIZER_KEY]!;
const LOG_LEVEL = process.env[ENV.LOG_LEVEL];
const logger = new NaiveLogger(LOG_LEVEL);

for (const item of [
  ENV.WORKER_CREDENTIAL_KEY,
  ENV.CODE_PATH_KEY,
  ENV.IPC_PATH_KEY,
  ENV.FUNC_HANDLER_KEY,
  ENV.FUNC_INITIALIZER_KEY,
  ENV.LOG_LEVEL,
]) {
  delete process.env[item];
}

logger.info('CODE_PATH:', CODE_PATH);
logger.info('IPC_PATH:', IPC_PATH);
logger.info('HANDLER:', HANDLER);
logger.info('INITIALIZER:', INITIALIZER);
logger.debug('WORKER_CREDENTIAL:', WORKER_CREDENTIAL);

function parseXXer(name?: string) {
  if (!name) return null;

  const splited = name.split('.');
  if (splited.length < 2) {
    return {};
  }

  const func = splited[splited.length - 1];
  splited.pop();
  const filename = path.join(CODE_PATH, ...splited);
  return {
    filename,
    func,
  };
}

function parseHandler() {
  const handlerInfo = parseXXer(HANDLER);
  let handler;

  if (handlerInfo == null) {
    handler = () => {
      throw new Error('No handler specified');
    };
  } else if (handlerInfo.filename == null || handlerInfo.func === null) {
    handler = () => {
      throw new Error(`Invalid handler key ${HANDLER}`);
    };
  } else {
    try {
      handler = require(handlerInfo.filename)[handlerInfo.func];
    } catch (e) {
      handler = () => {
        throw e;
      };
    }
  }

  if (typeof handler !== 'function') {
    handler = () => {
      throw new Error(`Handler ${HANDLER} is not a function.`);
    };
  }
  return handler;
}

type Initializer = (ctx: Context) => Promise<void> | void;
function parseInitializer(): Initializer | undefined {
  const initializerInfo = parseXXer(INITIALIZER);
  if (initializerInfo == null) return;
  let initializer;
  if (initializerInfo.filename == null || initializerInfo.func == null) {
    initializer = () => {
      throw new Error(`Invalid handler key ${HANDLER}`);
    };
  } else {
    try {
      initializer = require(initializerInfo.filename)[initializerInfo.func];
    } catch (e) {
      initializer = () => {
        throw e;
      };
    }
  }

  if (typeof initializer !== 'function') {
    initializer = () => {
      throw new Error(`Initializer ${INITIALIZER} is not a function`);
    };
  }
  return initializer;
}

export type OnInit = (ctx: Context) => Promise<void>;
export type OnRequest = (ctx: Context, req: IncomingMessage, res: ServerResponse) => Promise<any>;
export interface StartClientInit {
  serverPath: string;
  credential: string;
  onInit: OnInit;
  onRequest: OnRequest;
  logger: NaiveLogger;
}
export default function starter(startClient: (init: StartClientInit) => void) {
  let initializer: Initializer | undefined;
  let initializerLoaded = false;
  let handler: OnRequest = () => {
    throw new Error('Worker is not initialized yet');
  };
  let handlerLoaded = false;

  startClient({
    serverPath: IPC_PATH,
    credential: WORKER_CREDENTIAL,
    onInit: async ctx => {
      if (!initializerLoaded) {
        initializerLoaded = true;
        initializer = parseInitializer();
      }
      if (!handlerLoaded) {
        handlerLoaded = true;
        handler = parseHandler();
      }
      if (initializer) {
        await initializer(ctx);
      }
    },
    onRequest: async (ctx, req, res) => {
      await handler(ctx, req, res);
    },
    logger,
  });
};
