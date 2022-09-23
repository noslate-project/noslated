import fs from 'fs';
import * as _ from 'lodash';
import { BaseOf } from './sdk_base';
import { EventEmitter, once } from 'events';
import { Guest } from './rpc/guest';
import { sleep } from './util';
import { BasePanelClient } from './base_panel_client';
import { connectivityState } from '@grpc/grpc-js';
import { Config } from '#self/config';
import { ILogger } from '@midwayjs/logger';

export class BasePanelClientManager extends BaseOf(EventEmitter) {
  #clients: BasePanelClient[];
  #clientAvailableMap: WeakMap<BasePanelClient, boolean>;
  #clientEvents: WeakMap<BasePanelClient, BasePanelClientEventMap>;

  private sockDir: string;

  /**
   * constructor
   * @param {Config} config The global configuration object.
   * @param {number} sockCount UDS files count for this panel manager.
   * @param {ILogger} logger The logger object.
   */
  constructor(public config: Config, private sockCount: number, private logger: ILogger) {
    super();

    this.sockDir = config.dirs.aliceSock;

    this.#clients = [];
    this.#clientEvents = new WeakMap();
    this.#clientAvailableMap = new WeakMap();
  }

  #onClientStateChanged(client: BasePanelClient, state: connectivityState) {
    if (state === Guest.connectivityState.READY) {
      Promise.resolve()
        .then(() => this.#onClientReady(client))
        .catch(error => {
          this.logger.error('Unexpected error on client ready handler', error);
        });
    } else {
      this.#clientAvailableMap.set(client, false);
    }
  }

  #onClientError(client: BasePanelClient, err: Error) {
    this.logger.error('A client occurred a fatal error. Try regenerate one.', err);

    // regenerate
    let panelId = null;
    for (let i = 0; i < this.#clients.length; i++) {
      if (this.#clients[i] !== client) continue;
      panelId = i;
    }

    if (panelId !== null) {
      const newClient = this._createPanelClient(panelId);
      this.#addClientEvents(newClient);
      this.#clients[panelId] = newClient;
    }

    // destroy old one
    this.#removeClientEvents(client);
    Promise.resolve()
      .then(() => client.close())
      .catch(e => {
        this.logger.error('closing errored client with error', e);
      });
  }

  /**
   * Add client events
   * @param {BasePanelClient} client The client object
   */
  #addClientEvents(client: BasePanelClient) {
    const events = {
      error: this.#onClientError.bind(this, client),
      stateChanged: this.#onClientStateChanged.bind(this, client),
    };
    this.#clientEvents.set(client, events);

    client.on(Guest.events.CONNECTIVITY_STATE_CHANGED, events.stateChanged);
    client.on('error', events.error);
    client.ready().then(
      () => this.#onClientReady(client),
      events.error
    );
  }

  /**
   * Remove client events
   * @param {BasePanelClient} client The client object
   */
  #removeClientEvents(client: BasePanelClient) {
    const events = this.#clientEvents.get(client);
    if (events) {
      client.removeListener('connected', events.stateChanged);
      client.removeListener('error', events.error);
    }
  }

  /**
   * _init
   * @protected
   * @return {Promise<void>} Init result.
   */
  async _init() {
    this.logger.info('starting...');
    await fs.promises.mkdir(this.sockDir, { recursive: true });

    for (let i = 0; i < this.sockCount; i++) {
      const client = this._createPanelClient(i);
      this.#clientAvailableMap.set(client, false);
      this.#addClientEvents(client);
      this.#clients.push(client);
    }

    await Promise.race([
      once(this, 'newClientReady'),
      sleep(this.config.panel.panelFirstConnectionTimeout).then(() => {
        const error = new Error('Timeout on waiting first panel client ready');
        throw error;
      }),
    ]);
    this.logger.info('started.');
  }

  /**
   * @protected
   * @return {Promise<void>} Close result.
   */
  async _close() {
    const closes = [];
    for (const value of this.#clients) {
      this.#removeClientEvents(value);
      closes.push(value.close());
    }

    this.#clients = [];
    await Promise.all(closes);

    this.logger.info('closed');
  }

  #onClientReady(client: BasePanelClient) {
    this.logger.info(`${client.role} client ${client.panelId} ready.`);
    this.#clientAvailableMap.set(client, true);
    this.emit('newClientReady', client);
    return this._onClientReady(client);
  }

  /**
   * On client ready
   * @protected
   */
  _onClientReady(client: BasePanelClient) {
    client;
  }

  /**
   * Call to all panel clients by using `promiseMethod`.
   * @param {string} func The panel client function name.
   * @param {any[]} args The call arguments.
   * @param {'all' | 'allSettled' | 'any' | 'race'} promiseMethod The promise metohd.
   */
  async callToAllAvailableClients(func: string, args: any[], promiseMethod: PromiseMethod = 'all') {
    const promises = [];
    for (const client of this.#clients) {
      if (this.#clientAvailableMap.get(client)) {
        promises.push(client[func].call(client, ...args));
      }
    }
    return await Promise[promiseMethod](promises);
  }

  // eslint-disable-next-line
  /**
   * Create a panel client belong to current client manager.
   * @protected
   * @param {number} panelId The panel ID.
   * @return {Guest} The created client object.
   */
  _createPanelClient(panelId: number): BasePanelClient {  // eslint-disable-line
    throw new Error('_createPanelClient() should be implemented');
  }

  /**
   * Get all clients.
   * @return {Guest[]} All clients.
   */
  clients() {
    return [ ...this.#clients ];
  }

  /**
   * Get all available clients.
   * @return {Guest[]} All available clients.
   */
  availableClients(): BasePanelClient[] {
    return this.#clients.filter((c) => {
      return c && this.#clientAvailableMap.get(c);
    });
  }

  /**
   * Sample a random available client.
   * @return {Guest} A random available client.
   */
  sample() {
    const availableClients = this.availableClients();
    if (!availableClients.length) return null;
    return _.sample(availableClients);
  }
}

interface BasePanelClientEventMap {
  error: (/* client: BasePanelClient by bind*/ err: Error) => void;
  stateChanged: (/* client: BasePanelClient by bind*/ state: connectivityState) => void
}

type PromiseMethod = 'all' | 'allSettled' | 'any' | 'race';