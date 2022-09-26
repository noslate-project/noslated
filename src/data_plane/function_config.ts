export class FunctionConfig {
  useInspector: boolean;

  constructor() {
    this.useInspector = false;
  }

  setUseInspector(use: boolean) {
    this.useInspector = use;
  }

  getUseInspector() {
    return this.useInspector;
  }
}

export class FunctionConfigBag {
  map: Map<string, FunctionConfig>;

  constructor() {
    this.map = new Map();
  }

  get(name: string) {
    if (this.map.has(name)) {
      return this.map.get(name);
    }

    const config = new FunctionConfig();
    this.map.set(name, config);
    return config;
  }

  delete(name: string) {
    this.map.delete(name);
  }
}
