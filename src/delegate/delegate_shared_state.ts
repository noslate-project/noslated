import { AliceServer } from './alice_ipc';
import type { NamespaceResolver } from './namespace';
import { Meter, Counter, ValueRecorder } from '@opentelemetry/api';

class DelegateSharedState {
  #namespaceResolver: NamespaceResolver;

  daprAdaptor: any = null;

  #serverPath;
  server!: AliceServer | null;

  /**
   * MARK: - Metrics
   * @type {otel.Meter}
   */
  meter: Meter | undefined;
  triggerCounter: Counter | undefined;
  triggerDurationRecorder: ValueRecorder | undefined;

  constructor(namespaceResolver: NamespaceResolver, serverPath: string) {
    this.#namespaceResolver = namespaceResolver;

    this.#serverPath = serverPath;
  }

  get serverPath() {
    return this.#serverPath;
  }

  get namespaceResolver() {
    return this.#namespaceResolver;
  }
}

export {
  DelegateSharedState,
};
