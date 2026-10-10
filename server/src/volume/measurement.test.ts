import { expect, test } from 'vitest';
import { limitsFromSimulation, summarizeRows } from './measurement.js';

test('budget limits round compute upward and loaded bytes to the next page', () => {
  expect(limitsFromSimulation(101, 32768)).toEqual({ units: 112, loadedBytes: 65536 });
  expect(() => limitsFromSimulation(undefined, 10)).toThrow();
  expect(() => limitsFromSimulation(100, undefined)).toThrow();
  expect(() => limitsFromSimulation(1400000, 1)).toThrow();
});
test('headline excludes load tests and failed transactions and uses exact metadata', () => {
  const row = { signature: 'fixture', feeLamports: 5000, computeUnits: 100, slot: 1, error: null, source: 'measurement' as const };
  expect(summarizeRows([row, { ...row, signature: 'load', source: 'load_test' }, { ...row, signature: 'failed', error: 'failed' }])).toEqual({ payments: 1, totalFeeLamports: '5000', medianComputeUnits: 100 });
  expect(() => summarizeRows([row, row])).toThrow();
  expect(() => summarizeRows([{ ...row, feeLamports: NaN }])).toThrow();
});
