import childProcess from 'child_process';
import { EventEmitter, once } from 'events';
import { aworker } from '../../proto/aworker';
import { CanonicalCode, NoslatedClient } from '../noslated_ipc';

const logger = require('#self/lib/logger').get('test-client');

function child() {
  let client: NoslatedClient;
  process.on('message', ({ type, args }: CallbackArgs) => {
    console.log('[CLIENT CHILD] client process received message', {
      type,
      args,
    });
    if (type === 'connect') {
      return connect(...args);
    }
    if (type === 'close') {
      return close();
    }
    if (type === 'resourcePut') {
      return client.resourcePut(...args).then(ret => {
        process.send?.({ type, args: ret });
      });
    }
  });

  function connect(serverPath: string, credential: string) {
    if (client != null) {
      return;
    }
    client = new NoslatedClient(serverPath, credential);
    client.onCollectMetrics = () => {
      return {
        integerRecords: [
          {
            name: 'test',
            value: 1,
            labels: [
              {
                key: 'my_label',
                value: 'foo',
              },
            ],
          },
        ],
      };
    };
    client.onRequest = (
      method,
      streamId,
      metadata,
      hasInputData,
      hasOutputData,
      callback
    ) => {
      process.send?.({ type: 'request', args: [method] });
      if (method === 'hang-body') {
        return callback(CanonicalCode.OK, null, {
          status: 200,
          metadata: {},
        } as aworker.ipc.ITriggerResponseMessage);
      }
    };

    const onEvent =
      (type: string) =>
      (...args: any[]) =>
        process.send?.({ type, args });
    client.onStreamPush = onEvent('streamPush');
    client.onResourceNotification = onEvent('resourceNotification');
    client.onDisconnect = onEvent('disconnect');
    client.start().then(() => {
      process.send?.({ type: 'bind', args: [] });
    });
  }
  function close() {
    if (client == null) {
      return;
    }
    client.close();
    // TODO: proper close;
    process.exit(0);
  }

  process.send?.({ type: 'ready' });
}

export class TestClient extends EventEmitter {
  client: any;

  constructor(public serverPath: string, public credential: string) {
    super();
  }

  connect() {
    if (this.client) {
      return;
    }
    this.client = childProcess.fork(__filename, ['child'], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    this.client.on('message', ({ type, args }: CallbackArgs) => {
      logger.info('client controller received message', { type, args });
      if (type === 'ready') {
        this.client.send({
          type: 'connect',
          args: [this.serverPath, this.credential],
        });
        return;
      }
      this.emit(type, args);
    });
    this.client.on('exit', (code: string, signal: string) => {
      logger.info(
        'client process exited with code(%d) and signal(%s)',
        code,
        signal
      );
    });
  }

  get pid() {
    return this.client?.pid;
  }

  resourcePut(
    resourceId: string,
    action: aworker.ipc.ResourcePutAction,
    token: string
  ) {
    this.client.send({
      type: 'resourcePut',
      args: [resourceId, action, token],
    });
  }

  async close() {
    let exitFuture;
    if (this.client) {
      this.client.send({ type: 'close' });
      exitFuture = once(this.client, 'exit');
      this.client = null;
    }
    return exitFuture;
  }
}

type CallbackArgs = { type: string; args: [any, any] };

if (require.main === module && process.argv[2] === 'child') {
  child();
}
