import { baselineDir } from '#self/test/common';
import {
  CollectionResult,
  DataPoint,
  MetricReader,
} from '@opentelemetry/sdk-metrics';
import { MetricAttributes } from '@opentelemetry/api';

export const nodeJsWorkerTestItem = {
  name: 'node_worker_echo',
  profile: {
    name: 'node_worker_echo',
    runtime: 'nodejs',
    url: `file:///${baselineDir}/node_worker_echo`,
    handler: 'index.handler',
    signature: 'md5:234234',
  },
} as const;
export const serverlessWorkerTestItem = {
  name: 'aworker_echo',
  profile: {
    name: 'aworker_echo',
    runtime: 'aworker',
    url: `file://${baselineDir}/aworker_echo`,
    sourceFile: 'index.js',
    signature: 'md5:234234',
  },
} as const;

export class TestMetricReader extends MetricReader {
  protected async onForceFlush(): Promise<void> {}
  protected async onShutdown(): Promise<void> {}
}

function attributesEquals(
  lhs: { [x: string]: any },
  rhs: { [x: string]: any }
) {
  const lhsKeys = Object.keys(lhs).sort();
  const rhsKeys = Object.keys(rhs).sort();
  if (lhsKeys.length !== rhsKeys.length) {
    return false;
  }

  for (let idx = 0; idx < lhsKeys.length; idx++) {
    if (lhs[lhsKeys[idx]] !== rhs[lhsKeys[idx]]) {
      return false;
    }
  }

  return true;
}

export function getMetricRecords<T>(
  result: CollectionResult,
  name: any,
  attributes: MetricAttributes
) {
  if (result.errors.length) {
    throw new AggregateError(result.errors);
  }
  return result.resourceMetrics.scopeMetrics
    .flatMap(it => it.metrics)
    .filter(metric => {
      return metric.descriptor.name === name;
    })
    .flatMap<DataPoint<T>>(it => it.dataPoints as unknown as DataPoint<T>[])
    .filter(it => {
      return attributesEquals(it.attributes, attributes);
    });
}
