import { metrics } from '@opentelemetry/api-metrics';
const version = require('#self/package.json').version;

export function getMeter() {
  const meter = metrics.getMeter('noslated', version);
  return meter;
}
