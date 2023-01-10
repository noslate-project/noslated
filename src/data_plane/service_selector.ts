import _ from 'lodash';
import * as root from '#self/proto/root';

export type ServiceType = 'default' | 'proportional-load-balance';

export interface LoadBalanceSelector {
  selector: DefaultServiceSelector;
  proportion: number;
}

export interface DefaultServiceSelector {
  functionName: string;
}

export interface ServiceProfileItem
  extends Omit<root.noslated.data.IFunctionService, 'selectors' | 'selector'> {
  name: string;
  type: ServiceType;
  selectors?: LoadBalanceSelector[];
  selector?: DefaultServiceSelector;
}

enum ServiceTypes {
  ProportionalLoadBalance = 'proportional-load-balance',
}

class ServiceSelector {
  map: Map<string, ServiceProfileItem>;
  constructor(profiles: ServiceProfileItem[] = []) {
    this.map = new Map();
    for (const item of profiles) {
      this.map.set(item.name, item);
    }
  }

  toJSON() {
    return Array.from(this.map.values());
  }

  select(serviceName: string) {
    const item = this.map.get(serviceName);
    if (item == null) {
      return;
    }
    switch (item.type) {
      case ServiceTypes.ProportionalLoadBalance: {
        return this.proportionalSelect(item);
      }
      default: {
        return item.selector;
      }
    }
  }

  proportionalSelect(item: ServiceProfileItem) {
    const rnd = Math.random();
    let prev = 0;

    for (const selector of item.selectors as LoadBalanceSelector[]) {
      prev += selector.proportion;
      if (rnd < prev) {
        return selector.selector;
      }
    }
    return _.last(item.selectors)!.selector;
  }
}

export { ServiceSelector };
