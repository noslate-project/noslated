import { aworker } from '../proto/aworker';

export interface InspectorTargetDescriptor {
  id: string;
  title: string;
  url: string;
}

export interface InspectorAgentDelegate {
  getTargetDescriptorOf(
    cred: string,
    target: aworker.ipc.IInspectorTarget
  ): InspectorTargetDescriptor;
}

export class DefaultInspectorAgentDelegate implements InspectorAgentDelegate {
  getTargetDescriptorOf(
    cred: string,
    target: aworker.ipc.IInspectorTarget
  ): InspectorTargetDescriptor {
    return target;
  }
}
