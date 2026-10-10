import { expect, test } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { volumeReport, registerVolumeRoutes, liveSolPrice } from './index.js';

test('costs are estimates from measured fees, load tests never inflate headlines', () => {
  const row = { signature: 'mock', slot: 1, feeLamports: 10000, computeUnits: 200, error: null, source: 'measurement' as const };
  const result = volumeReport([row, { ...row, signature: 'load', source: 'load_test' }], { usd: 100, observedAt: '2026-10-10T00:00:00Z', source: 'fixture' }, { blockComputeUnits: 1000, source: 'fixture' });
  expect(result.payments).toBe(1); expect(result.cost).toEqual({ label: 'ESTIMATE', usdPerPayment: 0.001, usdPer1000: 1 });
  expect(result.blockCapacity.paymentsPerBlock).toBe(5); expect(result.transactions).toHaveLength(1);
  expect(volumeReport([row], null).cost.usdPerPayment).toBeNull();
});
test('HTTP volume serves only completed pinned evidence and loses dollar claims when price fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loka-volume-fixture-')), measurementPath = join(directory, 'redeem.json');
  const rows = Array.from({ length: 20 }, (_, n) => ({ signature: `fixture-${n}`, slot: 1, feeLamports: 10000, computeUnits: 200, error: null, source: 'measurement' }));
  const data = { programId: 'fixture', generatedAt: '2026-10-10T00:00:00Z', source: 'measurement', network: 'devnet', complete: true, limits: { units: 220, loadedBytes: 32768 }, rows };
  await writeFile(measurementPath, JSON.stringify(data));
  const app = Fastify(); registerVolumeRoutes(app, { programId: 'fixture', measurementPath, price: async () => { throw new Error('offline fixture'); } });
  try {
    const response = await app.inject('/api/volume'); expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ payments: 20, totalFeeLamports: '200000', solPrice: null, cost: { label: 'ESTIMATE', usdPerPayment: null } });
    await writeFile(measurementPath, JSON.stringify({ ...data, complete: false })); expect((await app.inject('/api/volume')).statusCode).toBe(503);
    await writeFile(measurementPath, JSON.stringify({ ...data, programId: 'wrong-program' })); expect((await app.inject('/api/volume')).statusCode).toBe(503);
  } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
});
test('missing measurements fail closed without requesting a price', async () => {
  const app = Fastify(); registerVolumeRoutes(app, { programId: 'fixture', measurementPath: 'missing-test-fixture' });
  try { expect((await app.inject('/api/volume')).statusCode).toBe(503); } finally { await app.close(); }
});
test('price parser checks currency and records fetch time, never invents provider time', async () => {
  const fake = (async () => new Response(JSON.stringify({ data: { base: 'SOL', currency: 'USD', amount: '100' } }))) as typeof fetch;
  expect((await liveSolPrice(fake)).usd).toBe(100);
  await expect(liveSolPrice((async () => new Response('{}')) as typeof fetch)).rejects.toThrow();
});
