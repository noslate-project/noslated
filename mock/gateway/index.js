'use strict';

const PROJECT_DIR = '../../build/';

const fs = require('fs');
const path = require('path');

const _ = require('lodash');
const address = require('address');

const { config } = require(path.join(PROJECT_DIR, 'config'));
const Logger = require(path.join(PROJECT_DIR, 'lib/logger'));
Logger.setSink(Logger.getPrettySink());

const ejs = require('ejs');
const express = require('express');

const { AliceAgent } = require(path.join(PROJECT_DIR, 'sdk'));
const utils = require(path.join(PROJECT_DIR, 'lib/util'));

let configFilename = process.argv[2] || path.join(__dirname, 'MOCK_FUNCTION_PROFILE.json');
configFilename = path.resolve(process.cwd(), configFilename);

let MOCK_FUNCTION_PROFILE = JSON.parse(fs.readFileSync(configFilename, 'utf8'));

class Gateway {
  constructor() {
    this.logger = Logger.get('gateway');
    this.agent = new AliceAgent();
    this.dataWorkerStatsSnapshot = [];
  }

  getFunctionHeaders(req) {
    let ret;
    const b64 = req.get('x-alice-headers');
    if (!b64) {
      ret = [];
    } else {
      const jsonStr = Buffer.from(b64, 'base64').toString();
      try {
        ret = JSON.parse(jsonStr);
      } catch (e) {
        ret = [];
      }
    }

    let host;
    let referer;
    let cookie;
    let userAgent;
    let xForwardedFor = '';
    for (const pair of ret) {
      switch (pair[0].toLowerCase()) {
        case 'host': host = pair[1]; break;
        case 'referer':
        case 'referrer': referer = pair[1]; break;
        case 'x-forwarded-for': {
          xForwardedFor = pair[1];
          break;
        }
        case 'cookie': cookie = pair[1]; break;
        case 'user-agent': userAgent = pair[1]; break;
        default: break;
      }
    }

    if (!host) {
      host = req.get('host');
      if (host) ret.push([ 'host', host ]);
    }

    if (!referer) {
      referer = req.get('referer') || req.get('referrer');
      if (referer) ret.push([ 'referer', referer ]);
    }

    if (!cookie) {
      cookie = req.get('cookie');
      if (cookie) ret.push([ 'cookie', cookie ]);
    }

    if (!userAgent) {
      userAgent = req.get('user-agent');
      if (userAgent) ret.push([ 'user-agent', userAgent ]);
    }

    if (xForwardedFor) {
      xForwardedFor += ', ';
    }
    xForwardedFor += req.socket.address().address;
    _.remove(ret, pair => pair[0].toLowerCase() === 'x-forwarded-for');
    ret.push([ 'x-forwarded-for', xForwardedFor ]);

    return ret;
  }

  async initHTTPServer() {
    this.app = express();

    this.app.use(express.static(path.join(__dirname, '../../assets')));

    this.app.all('/', async (req, resp) => {
      const code = fs.readFileSync(path.join(__dirname, 'static', 'index.ejs'), 'utf8');
      resp.end(ejs.render(code, {
        functions: MOCK_FUNCTION_PROFILE,
      }));
    });

    this.app.get('/_ps', async (req, resp) => {
      config.turf.startTurfD = false;
      const turf = require(path.join(PROJECT_DIR, 'lib/turf'));
      const ret = await turf.ps();
      resp.send(ret.filter(item => [ 'forkwait', 'running' ].includes(item.status)));
    });

    this.app.get('/data_workers', async (req, resp) => {
      resp.send(this.dataWorkerStatsSnapshot);
    });

    this.app.get('/controller_workers', async (req, resp) => {
      const data = await this.agent.controlPanelClientManager.sample().getWorkerStatsSnapshot({});
      resp.send(data.brokers || []);
    });

    this.app.all(/^\/([^\/]*)(\/.*)?$/, async (req, resp) => {
      const start = Date.now();
      let end;
      const funcName = req.params[0];
      const { url, method } = req.query;

      let response;
      const headers = this.getFunctionHeaders(req);
      const metadata = { method, url, headers };
      try {
        this.logger.info(`funcName: ${funcName}, method: ${method}, url: ${url}`);
        response = await this.agent.invoke(funcName, req, metadata);
        end = Date.now();
      } catch (e) {
        end = Date.now();
        resp.set('x-funciton-duration', end - start);
        resp.status((e.status && e.status > 0) ? e.status : 500);
        resp.end(e.stack);
        this.logger.warn(`Request ${req.path} failed.`);
        this.logger.warn(e);
        this.logger.info('Current request failed, duration:', end - start);
        return;
      }

      resp.set('x-funciton-duration', end - start);
      response.pipe(resp);
      this.logger.info('Current request duration:', end - start);
    });

    const { promise, resolve, reject } = utils.createDeferred();
    try {
      this.app.listen(3000, () => {
        resolve();
        this.logger.info('mock alice httpd started.');
      });
    } catch (e) {
      reject(e);
    }

    return promise;
  }

  async setFunctionProfile(profile) {
    const _profile = JSON.parse(JSON.stringify(profile));
    _profile.forEach(p => {
      if (!p.url.startsWith('http')) {
        p.url = `file://${path.join(__dirname, p.url)}`;
      }
    });
    await this.agent.setFunctionProfile(_profile, 'IMMEDIATELY');
  }

  async start() {
    this.logger.debug('starting...');

    await this.agent.start();
    await this.setFunctionProfile(MOCK_FUNCTION_PROFILE, 'IMMEDIATELY');
    await this.agent.setPlatformEnvironmentVariables([{
      key: 'POD_IP',
      value: address.ip(),
    }]);
    await this.initHTTPServer();
    this.logger.info('started.');

    // test
    this.agent.setDaprAdaptor(path.join(__dirname, 'dapr.js'));
    this.agent.useInspector('emp', true);

    for (const client of this.agent.dataPanelClientManager.clients()) {
      await client.ready();
      client.subscribe('workerTrafficStats', data => {
        this.dataWorkerStatsSnapshot = data.brokers;
      });
    }

    fs.watch(path.dirname(configFilename), { persistent: true }, (type, filename) => {
      if (filename !== path.basename(configFilename)) return;
      const temp = JSON.parse(fs.readFileSync(configFilename, 'utf8'));
      if (!_.isEqual(temp, MOCK_FUNCTION_PROFILE)) {
        MOCK_FUNCTION_PROFILE = temp;
        this.setFunctionProfile(MOCK_FUNCTION_PROFILE, 'IMMEDIATELY');
      }
    });
  }
}

const gateway = new Gateway();
gateway.start();
