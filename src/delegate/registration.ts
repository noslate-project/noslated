import _ from 'lodash';
import { NoslatedStreamError } from './error';

import type { Readable, Writable } from 'stream';
import type { ClientRequest } from 'http';
import type { ResourceStub } from './resource';
import type { InvokeController } from './invoke_controller';

class WorkerState {
  writables = new Set<Writable>();
  /**
   * sid => Readable
   */
  #readableMap = new Map<number, Readable>();
  #resources = new Map<string, ResourceStub>();

  /** @type {Map<number, import('http').ClientRequest} */
  fetchRequests = new Map<number, ClientRequest>();

  #closing = false;

  addReadable(sid: number, readable: Readable) {
    if (this.#closing) {
      throw Error('Session is closing');
    }
    this.#readableMap.set(sid, readable);
  }

  removeReadable(sid: number) {
    this.#readableMap.delete(sid);
  }

  getReadable(sid: number) {
    return this.#readableMap.get(sid);
  }

  addWritable(writable: Writable) {
    if (this.#closing) {
      throw Error('Session is closing');
    }
    this.writables.add(writable);
  }

  removeWritable(writable: Writable) {
    this.writables.delete(writable);
  }

  addResource(token: string, resourceStub: ResourceStub) {
    this.#resources.set(token, resourceStub);
  }

  removeResource(token: string) {
    this.#resources.delete(token);
  }

  getResourceUsage() {
    return {
      writableCount: this.writables.size,
      readableCount: this.#readableMap.size,
      resourceCount: this.#resources.size,
      activeFetchRequestCount: this.fetchRequests.size,
    };
  }

  close() {
    this.#closing = true;
    const readables = this.#readableMap.values();
    this.#readableMap = new Map();
    const writables = this.writables;
    this.writables = new Set();
    const resources = this.#resources;
    this.#resources = new Map();

    const fetchRequests = this.fetchRequests.values();
    this.fetchRequests = new Map();

    for (const item of readables) {
      item.destroy(
        new NoslatedStreamError(
          'Peer connection closed',
          'PEER_CONNECTION_CLOSED'
        )
      );
    }
    for (const item of writables) {
      item.destroy(
        new NoslatedStreamError(
          'Peer connection closed',
          'PEER_CONNECTION_CLOSED'
        )
      );
    }
    for (const item of fetchRequests) {
      item.destroy(new Error('aborted'));
    }

    const group = _.groupBy(
      Array.from(resources.entries()),
      item => item[1]._resourceId
    );
    _.map(group, list => {
      if (list.length === 0) {
        return;
      }
      const resource = list[0][1];
      const tokens = list.map(it => it[0]);
      resource.cleanup(tokens);
    });
  }
}

class CredentialRegistration {
  diagnosticSessionId: number | undefined;
  invokeController: InvokeController | undefined;

  closed = false;

  state = new WorkerState();

  constructor(
    public credential: string,
    public sessionId: number,
    public preemptive: boolean
  ) {}

  setInvokeController(it: InvokeController) {
    this.invokeController = it;
  }

  close() {
    this.state.close();
    this.closed = true;
  }
}

export { WorkerState, CredentialRegistration };
