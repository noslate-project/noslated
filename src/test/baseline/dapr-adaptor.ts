import { Base } from '#self/lib/sdk_base';
import { ILogger } from '@midwayjs/logger';

class DaprAdaptor extends Base {
  logger: ILogger;

  constructor(options: any) {
    super();
    this.logger = options.logger;
  }

  async _init() {
    this.logger.debug('hello DaprAdaptor init');
  }

  invoke(init: any) {
    this.logger.debug('dapr invoke', init);
    const { appId, methodName, data } = init;
    if (appId === 'hello-world' && methodName === 'echo') {
      return {
        status: 200,
        data: Buffer.from(
          JSON.stringify({
            appId,
            methodName,
            data: data.toString('utf8'),
          })
        ),
      };
    }
    return {
      status: 500,
      data: Buffer.from('unknown operation'),
    };
  }

  binding(init: any) {
    this.logger.debug('dapr binding', init);
    const { name, metadata, operation, data } = init;
    if (name === 'key-value' && operation === 'get') {
      return {
        status: 200,
        data: Buffer.from(
          JSON.stringify({
            name,
            metadata,
            operation,
            data: data.toString('utf8'),
          })
        ),
      };
    }
    return {
      status: 500,
      data: Buffer.from('unknown operation'),
    };
  }
}

module.exports = DaprAdaptor;
