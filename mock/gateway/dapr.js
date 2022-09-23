'use strict';

const { Base } = require('#self/lib/sdk_base');

const logger = require('#self/lib/logger').get('mock dapr');

class DaprAdaptor extends Base {
  async _init() {
    //
  }

  invoke(init) {
    const { appId, methodName, data } = init;
    logger.info('on dapr invoke', init);
    return {
      status: 200,
      data: Buffer.from(JSON.stringify({
        message: 'echo',
        req: {
          appId,
          methodName,
          data: data.toString('utf8'),
        },
      })),
    };
  }

  binding(init) {
    const { name, metadata, operation, data } = init;
    logger.info('on dapr binding', init);
    return {
      status: 200,
      data: Buffer.from(JSON.stringify({
        message: 'echo',
        req: {
          name, metadata, operation,
          data: data.toString('utf8'),
        },
      })),
    };
  }
}

module.exports = DaprAdaptor;
