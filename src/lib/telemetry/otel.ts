// TODO(chengzhong.wcz): upgrade to latest @opentelemetry/api-metrics
import api from '@opentelemetry/api';
const version = require('#self/package.json').version;

export function getMeter() {
  const meter = api.metrics.getMeter('alice', version);
  return meter;
}
