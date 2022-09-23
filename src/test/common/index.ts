import path from 'path';
import assert from 'assert';
import { FIXTURES_DIR } from '../util';

const srcRoot = path.resolve(__dirname, '../..');

export function testName(filename: string) {
  return path.relative(srcRoot, filename);
}

export function assertApproxEquals(lhs: number, rhs: number, approx: number) {
  const delta = Math.abs(lhs - rhs);
  assert.ok(delta < approx, `Expect lhs(${lhs}) and rhs(${rhs}) to be in an approximate delta(${approx})`);
}

export const baselineDir = path.join(FIXTURES_DIR, 'baseline');
export const daprAdaptorDir = path.join(FIXTURES_DIR, 'dapr_adaptor');
