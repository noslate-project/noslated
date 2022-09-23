'use strict';

module.exports = class MockDaprAdaptor {
  isReady = false;

  async ready() {
    this.isReady = true;
  }

  async close() {
    this.isReady = false;
  }
}