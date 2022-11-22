import EventEmitter from 'events';
import path from 'path';
import { Meter, createNoopMeter } from '@opentelemetry/api';
import Logger from '../lib/logger';
import { aworker } from '../proto/aworker';
import { CredentialRegistration } from './registration';
import { DefaultNamespaceResolver, NamespaceResolver } from './namespace';
import { DelegateSharedState } from './delegate_shared_state';
import { InvokeController } from './invoke_controller';
import { ResourceStub } from './resource';
import { DelegateMetrics } from '#self/lib/telemetry/semantic_conventions';
import { NoslatedServer } from './noslated_ipc';
import { Readable } from 'stream';
import { Metadata, MetadataInit } from './request_response';
import { DaprAdaptor } from './dapr_adaptor';

const logger = Logger.get('delegate');

const { CredentialTargetType } = aworker.ipc;

export const { CanonicalCode, ResourcePutAction } = aworker.ipc;

export const Events = {
  bind: 'bind',
  disconnect: 'disconnect',
  diagnosticsBind: 'diagnostics-bind',
  diagnosticsDisconnect: 'diagnostics-disconnect',
  inspectorEvent: 'inspector-event',
  inspectorStarted: 'inspector-started',
};

type CommonCallback = (code: aworker.ipc.CanonicalCode, ...args: any[]) => void;

export class NoslatedDelegateService extends EventEmitter {
  /**
   * credential => CredentialRegistration
   * @type {Map<string, CredentialRegistration>}
   */
  #credentialsMap: Map<string, CredentialRegistration> = new Map();
  /**
   * sessionId => credential
   * @type {Map<string, string>}
   */
  #sessionIdMaps: Map<number, string> = new Map();

  /**
   * @type {DelegateSharedState}
   */
  #sharedState: DelegateSharedState;

  #ops = {
    Credentials: async (sessionId: number, params: aworker.ipc.CredentialsRequestMessage, callback: CommonCallback) => {
      const { cred, type } = params;
      logger.debug('on credentials', params);
      if (!this.#credentialsMap.has(cred)) {
        logger.warn('unknown credential', cred);
        callback(CanonicalCode.CLIENT_ERROR);
        return;
      }
      if (type === CredentialTargetType.Data) {
        let reg = this.#credentialsMap.get(cred);
        if (!reg?.preemptive && reg?.sessionId != null) {
          logger.warn('conflict credential', cred);
          return callback(CanonicalCode.CLIENT_ERROR);
        }
        const isPreemption = reg?.preemptive && reg.sessionId != null;
        if (isPreemption) {
          const { sessionId } = reg as any;
          this.#sessionIdMaps.delete(sessionId);
          this.#sharedState.server!.terminateSession(sessionId);
          reg?.close();
        }
        reg = new CredentialRegistration(cred, sessionId, reg?.preemptive as boolean);
        const invokeController = new InvokeController(this.#sharedState, reg, this);
        reg.setInvokeController(invokeController);

        this.#credentialsMap.set(cred, reg);
        this.#sessionIdMaps.set(sessionId, cred);
        callback(CanonicalCode.OK);
        if (!isPreemption) {
          this.emit(Events.bind, cred);
        }
      } else if (type === CredentialTargetType.Diagnostics) {
        const reg = this.#credentialsMap.get(cred);
        if (reg?.sessionId == null) {
          logger.warn('diagnostic client connected without data channel', cred);
          return callback(CanonicalCode.CLIENT_ERROR);
        }
        reg.diagnosticSessionId = sessionId;
        this.#sessionIdMaps.set(sessionId, cred);
        callback(CanonicalCode.OK);
        this.emit(Events.diagnosticsBind, cred);
      }
    },
    InspectorEvent: async (sessionId: number, params: aworker.ipc.InspectorCommandRequestMessage, callback: CommonCallback) => {
      const cred = this.#sessionIdMaps.get(sessionId);
      if (cred == null) {
        callback(CanonicalCode.CLIENT_ERROR);
        return;
      }

      callback(CanonicalCode.OK);
      this.emit(Events.inspectorEvent, cred, {
        inspectorSessionId: params.sessionId,
        message: params.message,
      });
    },
    InspectorStarted: async (sessionId: number, params: any, callback: CommonCallback) => {
      const cred = this.#sessionIdMaps.get(sessionId);
      if (cred == null) {
        callback(CanonicalCode.CLIENT_ERROR);
        return;
      }

      callback(CanonicalCode.OK);
      this.emit(Events.inspectorStarted, cred);
    },
  };
  #onRequest = (sessionId: number, op: string, params: any, callback: CommonCallback) => {
    logger.debug('received request', sessionId, op, params);
    const handler = this.#ops[op];
    if (handler != null) {
      handler.call(this, sessionId, params, callback);
      return;
    }
    const reg = this.#getRegistration(sessionId);
    if (reg == null) {
      return;
    }
    try {
      reg?.invokeController![op](params, (code: aworker.ipc.CanonicalCode, ...args: any[]) => {
        if (code !== CanonicalCode.OK) {
          logger.error('unexpected exception on handling %s(session %s), code(%s)', op, sessionId, code, ...args);
        }
        callback(code, ...args);
      });
    } catch (e) {
      logger.error('unexpected exception on handling %s(session %s)', op, sessionId, e);
      throw e;
    }
  };
  #onDisconnect = (sessionId: number) => {
    logger.debug('session disconnected', sessionId);
    const credential = this.#sessionIdMaps.get(sessionId);
    this.#sessionIdMaps.delete(sessionId);
    if (credential == null) {
      return;
    }
    const reg = this.#credentialsMap.get(credential);
    if (reg == null) {
      return;
    }
    const { sessionId: dataSession, diagnosticSessionId } = reg;
    const eventsToEmit = [];
    if (sessionId === dataSession) {
      reg.close();
      this.#credentialsMap.delete(credential);
      this.resetPeer(credential);
      eventsToEmit.push(Events.disconnect, Events.diagnosticsDisconnect);
    } else if (sessionId === diagnosticSessionId) {
      reg.diagnosticSessionId = undefined;
      eventsToEmit.push(Events.diagnosticsDisconnect);
    }
    for (const ev of eventsToEmit) {
      process.nextTick(() => {
        this.emit(ev, credential);
      });
    }
  };
  #started = () => {
    if (this.#sharedState.server != null) {
      return true;
    }
    return false;
  };

  #getRegistration = (sessionId: number) => {
    const credential = this.#sessionIdMaps.get(sessionId);
    if (credential == null) {
      return;
    }
    const reg = this.#credentialsMap.get(credential);
    return reg;
  }

  /**
   *
   * @param {string} serverPath -
   * @param {object} [options] -
   * @param {otel.Meter} [options.meter] -
   * @param {NamespaceResolver} [options.namespaceResolver] -
   */
  constructor(serverPath?: string | undefined, options?: { meter: Meter; namespaceResolver: NamespaceResolver; }) {
    super();

    if (typeof serverPath === 'object') {
      options = serverPath;
      serverPath = undefined;
    }

    serverPath = serverPath ?? path.resolve('./noslated.sock');

    this.#sharedState = new DelegateSharedState(options?.namespaceResolver ?? new DefaultNamespaceResolver(), serverPath);

    this.#sharedState.meter = options?.meter ?? createNoopMeter();
    this.#sharedState.triggerCounter = this.#sharedState.meter!.createCounter(DelegateMetrics.TRIGGER_COUNT, {});
    this.#sharedState.triggerDurationHistogram = this.#sharedState.meter!.createHistogram(DelegateMetrics.TRIGGER_DURATION, {});
  }

  start() {
    if (this.#sharedState.server) {
      return;
    }
    const server = new NoslatedServer(this.#sharedState.serverPath, Logger.get('noslated server'));
    server.onRequest = this.#onRequest;
    server.onDisconnect = this.#onDisconnect;
    this.#sharedState.server = server;
    this.#sharedState.server!.start();
  }

  close() {
    if (this.#sharedState.server == null) {
      return;
    }
    for (const credential of this.#credentialsMap.keys()) {
      this.resetPeer(credential);
    }
    this.#sharedState.server.close();
    this.#sharedState.server = null;

    this.#sharedState.daprAdaptor?.close?.();

    queueMicrotask(() => {
      for (const sessionId of this.#sessionIdMaps.keys()) {
        this.#onDisconnect(sessionId);
      }
    });
  }

  /**
   *
   * @param {string} credential client credential
   * @param {object} [options] can be preempted.
   * @param {boolean} [options.preemptive] can be preempted. Used in testing environment.
   */
  register(credential: string, options: { preemptive?: boolean } = {}) {
    logger.debug('register credential', credential);
    this.#credentialsMap.set(credential, {
      preemptive: options.preemptive ?? false,
    } as any);
  }

  /**
   * NoslatedDelegateService#setDaprAdaptor
   * @param {DaprAdaptor} adaptor the adaptor object
   */
  setDaprAdaptor(adaptor: DaprAdaptor) {
    // 关闭旧的，防止泄露
    this.#sharedState.daprAdaptor?.close?.();

    this.#sharedState.daprAdaptor = adaptor;
  }

  /**
   * NoslatedDelegateService#resetPeer
   * @param {string} credential the credential
   */
  resetPeer(credential: string) {
    const reg = this.#credentialsMap.get(credential);
    this.#credentialsMap.delete(credential);
    if (reg == null) {
      return;
    }
    const { sessionId } = reg;
    if (typeof sessionId === 'number') {
      this.#sessionIdMaps.delete(sessionId);
      this.#sharedState.server!.terminateSession(sessionId);
    }
  }

  serverSockPath() {
    return this.#sharedState.serverPath;
  }

  #triggerPreamble = (credential: string, type?: aworker.ipc.CredentialTargetType) => {
    if (!this.#started()) {
      throw new Error('noslated server not started yet');
    }
    if (!this.#credentialsMap.has(credential)) {
      throw new Error('worker has not connected yet');
    }

    const reg = this.#credentialsMap.get(credential);
    switch (type) {
      case CredentialTargetType.Diagnostics: {
        if (reg?.diagnosticSessionId == null) {
          throw new Error('diagnostics client not connected yet');
        }
        return reg.diagnosticSessionId;
      }
      default: {
        if (reg?.sessionId == null) {
          throw new Error('client not connected yet');
        }
        return reg.sessionId;
      }
    }
  };

  /**
   * NoslatedDelegateService#trigger
   * @param {string} credential the credential
   * @param {string} method the method
   * @param {Buffer|Readable} data the data
   * @param {Metadata|object} [metadataInit] the metadata
   * @return {TriggerResponse} response
   */
  async trigger(credential: string, method: string, data: Buffer | Readable | null, metadataInit: MetadataInit | Metadata) {
    this.#triggerPreamble(credential);
    const reg = this.#credentialsMap.get(credential);
    return reg?.invokeController?.trigger(method, data, metadataInit);
  }

  async collectMetrics(credential: string) {
    const sessionId = this.#triggerPreamble(credential);
    const ret = await this.#sharedState.server!.collectMetrics(sessionId);
    return ret;
  }

  async inspectorStart(credential: string) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.inspectorStart(sessionId);
  }

  async GetInspectorTargets(credential: string) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    return this.#sharedState.server!.inspectorGetTargets(sessionId);
  }

  async InspectorStartSession(credential: string, inspectorSessionId: number, targetId: string) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.inspectorStartSession(
      sessionId,
      inspectorSessionId,
      targetId
    );
  }

  async InspectorEndSession(credential: string, inspectorSessionId: number) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.inspectorEndSession(
      sessionId,
      inspectorSessionId
    );
  }

  async SendInspectorCommand(credential: string, inspectorSessionId: number, message: string) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.inspectorCommand(
      sessionId,
      inspectorSessionId,
      message
    );
  }

  async tracingStart(credential: string, categories: string[]) {
    if (!Array.isArray(categories)) {
      throw new TypeError();
    }
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.tracingStart(sessionId, categories);
  }

  async tracingStop(credential: string) {
    const sessionId = this.#triggerPreamble(
      credential,
      CredentialTargetType.Diagnostics
    );
    await this.#sharedState.server!.tracingStop(sessionId);
  }

  makeResourceStub = (resourceId: string) => {
    const resourceStub = new ResourceStub(resourceId);
    resourceStub.on('notification', notificationTargets => {
      notificationTargets.forEach(([ token, credential ]: [string, string]) => {
        const reg = this.#credentialsMap.get(credential);
        if (reg == null) {
          return;
        }
        this.#sharedState.server!.resourceNotification(reg.sessionId, resourceId, token)
          .catch(err => {
            logger.error('unexpected error on resource(%s) notification to target(%s)', resourceId, reg.credential, err);
          });
      });
    });
    resourceStub.on('timeout', passiveReleasedTargets => {
      passiveReleasedTargets.forEach(([ token, credential ]: [string, string]) => {
        const reg = this.#credentialsMap.get(credential);
        if (reg == null) {
          return;
        }
        reg.state.removeResource(token);
      });
    });
    return resourceStub;
  }

  getResourceUsage(credential: string) {
    const reg = this.#credentialsMap.get(credential);
    if (reg?.state == null) {
      return;
    }
    return reg.state.getResourceUsage();
  }

  ref() {
    this.#sharedState.server!.ref();
  }

  unref() {
    this.#sharedState.server!.unref();
  }
}
