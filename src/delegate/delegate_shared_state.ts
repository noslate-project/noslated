import { NoslatedServer } from './noslated_ipc';
import type { NamespaceResolver } from './namespace';
import { Meter, Counter, Histogram } from '@opentelemetry/api';
import { DaprAdaptor } from './dapr_adaptor';

class DelegateSharedState {
  #namespaceResolver: NamespaceResolver;

  daprAdaptor: DaprAdaptor | null = null;

  #serverPath;
  server!: NoslatedServer | null;

  /**
   * MARK: - Metrics
   * @type {otel.Meter}
   */
  meter: Meter | undefined;
  triggerCounter: Counter | undefined;
  triggerDurationHistogram: Histogram | undefined;

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

export { DelegateSharedState };
