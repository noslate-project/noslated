export interface DaprAdaptorInvokeRequest {
  appId: string;
  methodName: string;
  data: Uint8Array;
}

export interface DaprAdaptorBindingRequest {
  name: string;
  metadata: any;
  operation: string;
  data: Uint8Array;
}

export interface DaprAdaptorResponse {
  status: number;
  data: Uint8Array;
  metadata?: Record<string, string | number>;
}

export interface DaprAdaptor {
  ready(): Promise<void>;
  close(): void | Promise<void>;
  invoke(req: DaprAdaptorInvokeRequest): Promise<DaprAdaptorResponse>;
  binding(req: DaprAdaptorBindingRequest): Promise<DaprAdaptorResponse>;
}
