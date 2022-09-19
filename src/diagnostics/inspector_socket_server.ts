import http, { IncomingMessage, ServerResponse } from 'http';
import WebSocket from 'ws';
import { debuglog } from 'util';

import { tryQ } from '#self/lib/util';
import { Socket } from 'net';
import { InspectorAgent } from './inspector_agent';
import InspectorProtocolJson from '../lib/json/inspector_protocol.json';

const debug = debuglog('alice:inspector_socket_server');
const HttpPathMatcher = /^\/json(?:\/(list|protocol|version))?$/;
const HandShakeFailedResponse = 'WebSockets request was expected';
const kInspectorProtocolJsonText = JSON.stringify(InspectorProtocolJson);

class InspectorSocketServer {
  #agent;
  #options;
  #server;
  #wss;
  #onRequest = (req: IncomingMessage, res: ServerResponse) => {
    const url = tryQ(() => new URL(req.url ?? '', `http://${req.headers.host}`));
    if (url == null) {
      res.statusCode = 400;
      res.end(HandShakeFailedResponse);
      return;
    }
    const pathname = url.pathname;
    const match = HttpPathMatcher.exec(pathname);
    if (match == null) {
      res.statusCode = 400;
      res.end(HandShakeFailedResponse);
      return;
    }

    const command = match[1];
    let body: string | Buffer = '';
    if (command == null || command === 'list') {
      body = JSON.stringify(this.#agent.getInspectorTargets(), null, 2);
    } else if (command === 'protocol') {
      body = kInspectorProtocolJsonText;
    } else if (command === 'version') {
      body = '{"Browser": "node.js/v12.18.4 alice/","Protocol-Version": "1.3"}';
    }

    if (body.length > 0) {
      res.statusCode = 200;
      body = Buffer.from(body);
      res.setHeader('Content-Type', 'application/json; charset=UTF-8');
      res.setHeader('Content-Length', body.byteLength);
      res.write(body);
    }
    res.end();
  };
  #onUpgrade = async (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = tryQ(() => new URL(req.url ?? '', `http://${req.headers.host}`));
    if (url == null) {
      socket.end(HandShakeFailedResponse);
      return;
    }
    const pathname = url.pathname;
    const id = pathname.substring(1);
    const inspectorSession = await this.#agent.accept(id);
    if (inspectorSession) {
      this.#wss.handleUpgrade(req, socket, head, ws => {
        inspectorSession.assignSocket(ws);
      });
    } else {
      debug('agent rejected upgrade', id);
      socket.end(HandShakeFailedResponse);
    }
  };

  /**
   * InspectorSocketServer#constructor
   */
  constructor(agent: InspectorAgent, options: { port?: number } = {}) {
    this.#agent = agent;
    this.#options = {
      ...options,
      port: options.port == null ? 9229 : options.port,
    };
    this.#server = http.createServer(this.#onRequest);
    this.#wss = new WebSocket.Server({ noServer: true });

    this.#server.on('upgrade', this.#onUpgrade);
  }

  async start() {
    return new Promise<void>(resolve => {
      this.#server.listen(this.#options.port, () => {
        const addr = this.address();
        debug(`inspector server started at ${addr}`);
        resolve();
      });
    });
  }

  async close() {
    return new Promise<void>((resolve, reject) =>
      this.#server.close(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      }));
  }

  address() {
    const address = this.#server.address();
    if (address == null) {
      return;
    }
    if (typeof address === 'string') {
      return address;
    }
    if (address.address === '::') {
      return `localhost:${address.port}`;
    }
    return `${address.address}:${address.port}`;
  }
}

export {
  InspectorSocketServer,
}
