import { resolveConfig } from './loader';

export const config = resolveConfig();
export { dumpConfig } from './loader';
export type Config = typeof config;
