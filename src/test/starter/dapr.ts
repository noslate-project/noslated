import { Base } from '#self/lib/sdk_base';
const logger = require('#self/lib/logger').get('test dapr adapter');

module.exports = class DaprAdaptor extends Base {
  async _init() {
    logger.info('hello DaprAdaptor init');
  }

  async invoke(init: any) {
    const { appId, data } = init;
    if (appId === 'timeout') {
      const timeout = Number(data.toString());
      await new Promise(resolve => setTimeout(resolve, timeout ?? 10_000));
      return {
        status: 500,
        data: Buffer.from('Request resolved'),
      };
    }
    if (appId === 'reject') {
      return {
        status: 500,
        data: Buffer.from('Request rejected'),
      };
    }
    return {
      status: 500,
      data: Buffer.from(''),
    };
  }

  async binding(init: any) {
    const { name, operation, metadata, data } = init;

    if (name === 'timeout') {
      const timeout = Number(data);
      await new Promise(resolve => setTimeout(resolve, timeout ?? 10_000));
      return {
        status: 500,
        data: Buffer.from('Request resolved'),
      };
    }

    if (name === 'reject') {
      return {
        status: 500,
        data: Buffer.from('Request rejected'),
      };
    }

    if (name === 'getOp') {
      return {
        status: 200,
        data: Buffer.from(`${operation}: ${data}, age: ${metadata.age}`),
      };
    }

    return {
      status: 500,
      data: Buffer.from(''),
    };
  }
};
