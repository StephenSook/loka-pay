import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { summarizeRows, type RedeemRow } from './measurement.js';

export interface PriceQuote { usd: number; observedAt: string; source: string }
// Provider time is retained separately from our fetch time. A failed quote produces no USD estimate.
export async function liveSolPrice(fetcher: typeof fetch = fetch): Promise<PriceQuote> {
  const response = await fetcher('https://api.coinbase.com/v2/prices/SOL-USD/spot', { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('SOL price unavailable');
  const body = await response.json() as { data?: { amount?: string; base?: string; currency?: string } };
  const usd = Number(body.data?.amount);
  if (body.data?.base !== 'SOL' || body.data.currency !== 'USD' || !Number.isFinite(usd) || usd <= 0) throw new Error('Invalid SOL price');
  return { usd, observedAt: new Date().toISOString(), source: 'https://api.coinbase.com/v2/prices/SOL-USD/spot' };
}
export function volumeReport(rows: RedeemRow[], price: PriceQuote | null, capacity?: { blockComputeUnits: number; source: string }) {
  const summary = summarizeRows(rows);
  if (price && (!Number.isFinite(price.usd) || price.usd <= 0 || !Number.isFinite(Date.parse(price.observedAt)) || !price.source)) throw new Error('Invalid price evidence');
  if (capacity && (!Number.isSafeInteger(capacity.blockComputeUnits) || capacity.blockComputeUnits <= 0 || !capacity.source)) throw new Error('Capacity requires a sourced configured block limit');
  const perPayment = summary.payments && price ? Number(summary.totalFeeLamports) / summary.payments / 1e9 * price.usd : null;
  return { network: 'devnet', signer: 'software P-256', scope: 'measured LOKA redeems, no network throughput claim',
    transactions: rows.filter(row => row.source === 'measurement'), ...summary, solPrice: price,
    cost: { label: 'ESTIMATE', usdPerPayment: perPayment, usdPer1000: perPayment === null ? null : perPayment * 1000 },
    blockCapacity: { label: 'ESTIMATE', formula: 'floor(configured block compute limit / measured median compute units)',
      paymentsPerBlock: capacity && summary.medianComputeUnits ? Math.floor(capacity.blockComputeUnits / summary.medianComputeUnits) : null,
      source: capacity?.source ?? null, limitation: 'Compute-only bound. Account locks, precompiles, bandwidth and validator policy can lower it. This is not measured LOKA throughput.' } };
}
export function registerVolumeRoutes(app: FastifyInstance, options: {
  programId: string; measurementPath: string; benchmarkPath?: string; price?: () => Promise<PriceQuote>; capacity?: { blockComputeUnits: number; source: string };
}): void {
  app.get('/api/volume', async (_request, reply) => {
    let data: { rows: RedeemRow[]; programId: string; generatedAt: string; limits: unknown; network: string; source: string; complete: boolean };
    try {
      data = JSON.parse(await readFile(options.measurementPath, 'utf8')); summarizeRows(data.rows);
      if (data.programId !== options.programId || data.network !== 'devnet' || data.source !== 'measurement' || data.complete !== true
        || !Number.isFinite(Date.parse(data.generatedAt)) || data.rows.length !== 20) throw new Error('Wrong measurement evidence');
    }
    catch { return reply.code(503).send({ error: 'measurements_unavailable' }); }
    let price: PriceQuote | null = null;
    try { price = await (options.price ?? liveSolPrice)(); } catch { /* Missing quote means no dollar claim. */ }
    let verification: unknown = null;
    if (options.benchmarkPath) {
      try {
        const bench = JSON.parse(await readFile(options.benchmarkPath, 'utf8'));
        if (bench.source === 'local_software_benchmark' && Number.isSafeInteger(bench.nproc) && bench.nproc > 0
          && typeof bench.cpuModel === 'string' && typeof bench.nodeVersion === 'string'
          && Number.isFinite(bench.results.noble.operationsPerSecond) && Number.isFinite(bench.results.nodeCrypto.operationsPerSecond)) verification = bench;
      } catch { /* No software benchmark claim without its artifact. */ }
    }
    return { programId: data.programId, measuredAt: data.generatedAt, limits: data.limits, verification, ...volumeReport(data.rows, price, options.capacity) };
  });
}
