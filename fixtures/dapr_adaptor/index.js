'use strict';

// module.exports = class MockDaprAdaptor {
//   isReady = false;

//   async ready() {
//     this.isReady = true;
//   }

//   async close() {
//     this.isReady = false;
//   }
// }

const { Base } = require('#self/lib/sdk_base');

class DaprAdaptor extends Base {
  logger;
  options;

  constructor(options) {
    super();
    this.logger = options.logger;
    this.options = options;
  }

  async _init() {
    this.logger.debug('hello DaprAdaptor init');
  }

  invoke(init) {
    this.logger.debug('dapr invoke', init);
    const { appId, methodName, data } = init;
    if (appId === 'hello-world' && methodName === 'echo') {
      return {
        status: 200,
        data: Buffer.from(
          JSON.stringify({
            appId,
            methodName,
            data: data.toString(
              this.options.encoding ? this.options.encoding : 'utf8'
            ),
          })
        ),
      };
    }
    return {
      status: 500,
      data: Buffer.from('unknown operation'),
    };
  }

  binding(init) {
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
            data: data.toString(
              this.options.encoding ? this.options.encoding : 'utf8'
            ),
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
