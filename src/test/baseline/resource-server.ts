import http from 'http';
import express from 'express';
import EventEmitter from 'events';

export class ResourceServer extends EventEmitter {
  static port = 23888;
  #app;
  #server;

  zombieRequestCount = 0;

  constructor() {
    super();
    this.#app = express();
    this.#app.get('/echo', async (req, resp) => {
      req.pipe(resp);
    });

    this.#app.get('/hello-world', async (req, resp) => {
      resp.statusCode = 200;
      resp.end('hello world');
    });

    this.#app.get('/black-hole', async (req, resp) => {
      this.zombieRequestCount++;
      resp.writeHead(200);
      /** write an empty data to enforce the writeHead */
      resp.write('');
      req.on('close', () => {
        this.emit('req-close', req);
        this.zombieRequestCount--;
      });
    });

    this.#server = http.createServer(this.#app);
  }

  async start() {
    return new Promise<void>((resolve, reject) => {
      this.#server.listen(ResourceServer.port, () => {
        resolve();
      });

      this.#server.on('error', (err: Error) => {
        reject(err);
      });
    });
  }

  async close() {
    return new Promise<void>((resolve, reject) => {
      this.#server.close(err => {
        if (err) {
          return reject(err);
        }
        resolve();
      });
    });
  }

  address() {
    return this.#server.address();
  }
}
