import { hrTime } from '@opentelemetry/core';
import { Batcher } from '@opentelemetry/metrics/build/src/export/Batcher';
import { baselineDir } from '#self/test/common';
import { MeterProvider, MetricRecord } from '@opentelemetry/metrics';

export const nodeJsWorkerTestItem = {
  name: 'node_worker_echo',
  profile: {
    name: 'node_worker_echo',
    runtime: 'nodejs-v16',
    url: `file:///${baselineDir}/node_worker_echo`,
    handler: 'index.handler',
    signature: 'md5:234234',
  },
};
export const serverlessWorkerTestItem = {
  name: 'aworker_echo',
  profile: {
    name: 'aworker_echo',
    runtime: 'aworker',
    url: `file://${baselineDir}/aworker_echo`,
    sourceFile: 'index.js',
    signature: 'md5:234234',
  },
};

/** Basic aggregator for LastValue which keeps the last recorded value. */
class LastValueAggregator {
  _current = 0;
  _lastUpdateTime = [ 0, 0 ];

  update(value: any) {
    this._current = value;
    this._lastUpdateTime = hrTime();
  }

  toPoint() {
    return {
      value: this._current,
      timestamp: this._lastUpdateTime,
    };
  }
}


/**
 * Processor which retains all dimensions/labels. It accepts all records and
 * passes them for exporting.
 */
export class TestProcessor extends Batcher {
  aggregatorFor(): any {
    return new LastValueAggregator();
  }

  process(record: MetricRecord) {
    const labels = Object.entries(record.labels)
      .map(it => `${it[0]}=${it[1]}`)
      .join(',');
    this._batchMap.set(record.descriptor.name + labels, record);
  }

  checkPointSet() {
    return Array.from(this._batchMap.values());
  }
}

/**
 *
 * @param {import('@opentelemetry/metrics).MeterProvider} meterProvider -
 */
export async function forceExport(meterProvider: MeterProvider) {
  return Promise.all(Array.from(meterProvider['_meters'].values()).map((it: any) => {
    return it.collect();
  }));
}

function labelObjectEquals(lhs: { [x: string]: any; }, rhs: { [x: string]: any; }) {
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

/**
 *
 * @param {TestProcessor} processor -
 * @param {string} name -
 * @param {object} labels -
 */
export function getMetricRecords(processor: { checkPointSet: () => any; }, name: any, labels: any) {
  const checkpointSet = processor.checkPointSet();
  return checkpointSet.filter((it: { descriptor: { name: any; }; labels: any; }) => {
    return it.descriptor.name === name && labelObjectEquals(it.labels, labels);
  });
}
