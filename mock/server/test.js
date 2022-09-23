'use strict';

const fs = require('fs');
const path = require('path');

const ejs = require('ejs');
const express = require('express');

const logger = require('../../lib/logger').get('test_server');

let configFilename = process.argv[2] || path.join(__dirname, 'MOCK_FUNCTION_PROFILE.json');
configFilename = path.resolve(process.cwd(), configFilename);

let MOCK_FUNCTION_PROFILE = JSON.parse(fs.readFileSync(configFilename, 'utf8'));

fs.watchFile(configFilename, () => {
  MOCK_FUNCTION_PROFILE = JSON.parse(fs.readFileSync(configFilename, 'utf8'));
  module.exports.agent.setFunctionProfile(MOCK_FUNCTION_PROFILE);
  logger.info('function profile updated', MOCK_FUNCTION_PROFILE);
});

class DaprAdaptor {
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

class TestServer {
  async start(agent) {
    this.agent = agent;
    agent.setDaprAdaptor(new DaprAdaptor());
    agent.setFunctionProfile(MOCK_FUNCTION_PROFILE);

    let resolve;
    let reject;
    const pro = new Promise((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
    this.app = express();

    this.app.use(express.static(path.join(__dirname, '../../assets')));

    this.app.all('/', async (req, resp) => {
      const code = fs.readFileSync(path.join(__dirname, 'static', 'index.ejs'), 'utf8');
      resp.end(ejs.render(code, {
        functions: agent.getFunctionProfile(),
      }));
    });

    this.app.get('/_ps', async (req, resp) => {
      const turf = require('../../lib/turf');
      const ret = await turf.ps();
      resp.send(ret);
    });

    this.app.all(/^\/([^\/]*)(\/.*)?$/, async (req, resp) => {
      const start = Date.now();
      const funcName = req.params[0];
      let url = req.url.substr(funcName.length + 1);
      if (!url.startsWith('/')) url = '/' + url;

      let response;
      try {
        logger.info(`funcName: ${funcName}, method: ${req.method}, url: ${url}`);
        response = await agent.invoke(funcName, req, {
          url,
          method: req.method,
        });
      } catch (e) {
        const end = Date.now();
        resp.set('x-funciton-duration', end - start);
        resp.status(e.status || 500);
        resp.end(e.stack);
        logger.warn(`Request ${req.path} failed.`);
        logger.warn(e);
        logger.info('Current request duration:', end - start);
        return;
      }

      const end = Date.now();
      resp.set('x-funciton-duration', end - start);
      response.pipe(resp);
      logger.info('Current request duration:', end - start);
    });

    try {
      this.app.listen(3000, () => {
        resolve();
        logger.info('Alice (Legacy HTTP adapter) started.');
      });
    } catch (e) {
      reject(e);
    }

    return pro;
  }
}

module.exports = new TestServer();
