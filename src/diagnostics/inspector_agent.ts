import { WebSocket } from 'ws';
import { InspectorSocketServer } from './inspector_socket_server';
import { NoslatedDelegateService, Events } from '#self/delegate/index';
import loggers from '#self/lib/logger';
import {
  DefaultInspectorAgentDelegate,
  InspectorAgentDelegate,
} from './inspector_agent_delegate';

const logger = loggers.get('inspector_socket_server');

const CredentialSymbol = Symbol('credential');
const ConnectedSessionIdsSymbol = Symbol('sessions');

interface InspectorTarget {
  [CredentialSymbol]: string;
  [ConnectedSessionIdsSymbol]: number[];
  description: string;
  devtoolsFrontendUrl: string;
  devtoolsFrontendUrlCompat: string;
  faviconUrl: string;
  id: string;
  title: string;
  type: string;
  url: string;
  webSocketDebuggerUrl: string;
}

class InspectorSession {
  #inspectorSessionId;
  #targetId;
  #agent;
  #ws: WebSocket | null = null;
  constructor(
    inspectorSessionId: number,
    targetId: string,
    agent: InspectorAgent
  ) {
    this.#inspectorSessionId = inspectorSessionId;
    this.#targetId = targetId;
    this.#agent = agent;
  }

  get targetId() {
    return this.#targetId;
  }

  assignSocket(ws: WebSocket) {
    this.#ws = ws;
    this.#ws.on('message', (message: string) => {
      this.#agent.sendInspectorCommand(
        this.#targetId,
        this.#inspectorSessionId,
        message
      );
    });
    this.#ws.on('close', () => {
      this.#agent.terminateSession(this.#inspectorSessionId);
    });
  }

  inspectorEvent(message: string) {
    if (this.#ws == null) {
      return;
    }
    this.#ws.send(message);
  }

  terminate() {
    if (this.#ws == null) {
      return;
    }
    this.#ws.terminate();
    this.#ws = null;
  }
}

export interface InspectorAgentOptions {
  port?: number;
  inspectorDelegate?: InspectorAgentDelegate;
}

export class InspectorAgent {
  #delegate;
  #inspectorDelegate: InspectorAgentDelegate;
  #server;
  #sessionSec = 0;
  #diagnosticsChannels = new Map();
  #targets = new Map<string, InspectorTarget>();
  #sessions = new Map<number, InspectorSession>();
  #onInspectorStarted = async (cred: string) => {
    let targets;
    try {
      targets = await this.#delegate.GetInspectorTargets(cred);
    } catch (e) {
      logger.error('list inspector targets failed', cred, e);
      return;
    }
    this.#diagnosticsChannels.set(cred, { targets });
    for (const target of targets) {
      const webSocketAddress = `${this.#server.address()}/${target.id}`;
      this.#targets.set(target.id, {
        [CredentialSymbol]: cred,
        [ConnectedSessionIdsSymbol]: [],
        description: 'noslated worker',
        devtoolsFrontendUrl: `devtools://devtools/bundled/js_app.html?experiments=true&v8only=true&ws=${webSocketAddress}`,
        devtoolsFrontendUrlCompat: `devtools://devtools/bundled/inspector.html?experiments=true&v8only=true&ws=${webSocketAddress}`,
        faviconUrl: 'https://noslate.midwayjs.org/img/logo.svg',
        id: target.id,
        title: target.title,
        // Mocking as a node process to disable web devtool tabs.
        type: 'node',
        url: target.url,
        webSocketDebuggerUrl: `ws://${webSocketAddress}`,
      });
      logger.debug('register target', target.id);
    }
  };
  #onDisconnect = (cred: string) => {
    const reg = this.#diagnosticsChannels.get(cred);
    if (reg == null) {
      return;
    }
    this.#diagnosticsChannels.delete(cred);
    const { targets } = reg;
    for (const target of targets) {
      const targetReg = this.#targets.get(target.id);
      this.#targets.delete(target.id);
      if (targetReg == null) {
        continue;
      }
      targetReg[ConnectedSessionIdsSymbol].forEach((sessionId: number) => {
        this.terminateSession(sessionId);
      });
    }
  };
  #inspectorEvent = (
    cred: string,
    {
      inspectorSessionId,
      message,
    }: { inspectorSessionId: number; message: string }
  ) => {
    const session = this.#sessions.get(inspectorSessionId);
    if (session == null) {
      return;
    }
    session.inspectorEvent(message);
  };

  /**
   * InspectorAgent#constructor
   */
  constructor(
    delegate: NoslatedDelegateService,
    options?: InspectorAgentOptions
  ) {
    this.#delegate = delegate;
    this.#server = new InspectorSocketServer(this, options);
    this.#inspectorDelegate =
      options?.inspectorDelegate ?? new DefaultInspectorAgentDelegate();

    this.#delegate.on(Events.inspectorStarted, this.#onInspectorStarted);
    this.#delegate.on(Events.disconnect, this.#onDisconnect);
    this.#delegate.on(Events.diagnosticsDisconnect, this.#onDisconnect);
    this.#delegate.on(Events.inspectorEvent, this.#inspectorEvent);
  }

  async start() {
    await this.#server.start();
  }

  async close() {
    await this.#server.close();
  }

  getInspectorTargets() {
    return Array.from(this.#targets.values()).map(it => {
      const facadeDesc = this.#inspectorDelegate.getTargetDescriptorOf(
        it[CredentialSymbol],
        it
      );
      return {
        description: it.description,
        devtoolsFrontendUrl: it.devtoolsFrontendUrl,
        devtoolsFrontendUrlCompat: it.devtoolsFrontendUrlCompat,
        faviconUrl: it.faviconUrl,
        id: it.id,
        type: it.type,
        webSocketDebuggerUrl: it.webSocketDebuggerUrl,
        title: facadeDesc.title,
        url: facadeDesc.url,
      };
    });
  }

  sendInspectorCommand(
    targetId: string,
    inspectorSessionId: number,
    message: string
  ) {
    const target = this.#targets.get(targetId);
    if (target == null) {
      return;
    }
    const credential = target[CredentialSymbol];
    this.#delegate
      .SendInspectorCommand(credential, inspectorSessionId, message)
      .catch((err: unknown) => {
        logger.error('unexpected error on send inspector command', err);
      });
  }

  async accept(targetId: string) {
    const reg = this.#targets.get(targetId);
    if (reg == null) {
      return false;
    }
    const credential = reg[CredentialSymbol];
    const inspectorSessionId = this.#sessionSec++;
    try {
      await this.#delegate.InspectorStartSession(
        credential,
        inspectorSessionId,
        targetId
      );
    } catch (e) {
      logger.error('failed to open inspector', e);
      return false;
    }

    const session = new InspectorSession(inspectorSessionId, targetId, this);
    reg[ConnectedSessionIdsSymbol].push(inspectorSessionId);
    this.#sessions.set(inspectorSessionId, session);

    return session;
  }

  terminateSession(inspectorSessionId: number) {
    logger.debug('terminate session', inspectorSessionId);
    const session = this.#sessions.get(inspectorSessionId);
    if (session == null) {
      return;
    }
    this.#sessions.delete(inspectorSessionId);
    session.terminate();

    const target = this.#targets.get(session.targetId);
    if (target == null) {
      return;
    }
    const credential = target[CredentialSymbol];
    const idx = target[ConnectedSessionIdsSymbol].indexOf(inspectorSessionId);
    target[ConnectedSessionIdsSymbol].splice(idx, 1);

    this.#delegate.InspectorEndSession(credential, inspectorSessionId).then(
      () => {
        logger.debug('inspector closed');
      },
      (err: unknown) => {
        logger.error('unexpected error on close inspector', err);
      }
    );
  }
}
