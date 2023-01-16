import { Container } from './container';

export interface ContainerManager {
  create(): Promise<Container>;
}

export class TurfContainerManager implements ContainerManager {
  create(): Promise<Container> {

  }

  
}
