import type { Database } from '../settle/store.js';
import { EXCLUDED_BY_DEFAULT, SOURCES, type Source } from './store.js';

// GET /api/stats recomputes every figure from payment_events on each call (PLAN.md 2.10).
// Timings name their two clocks as PAYMENT-V1 section 4.3 does:
//   settled after upload = block time - uploaded at (chain time minus server clock)
//   held offline = uploaded at - ACK received at (server clock minus the merchant phone's clock)
//   receipt to settlement = block time - ACK received at
// Amounts are mint base units as decimal strings; the sandbox USD figure assumes the 6-decimal test USDC mint.

export interface RunWindow { from: number; to: number }
export interface Figures {
  /** Uploads the server accepted (validated and claimed); paymentsSettled out of this is the headline ratio. */
  paymentsAccepted: number; paymentsPending: number;
  paymentsSettled: number; settledVolumeUnits: string; settledVolumeSandboxUsd: string;
  doubleSpendsRefused: number; failedOnChain: number;
  settledAfterUploadSeconds: { p50: number | null; p95: number | null; n: number };
  heldOfflineSeconds: { median: number | null; n: number };
  receiptToSettlementSeconds: { median: number | null; n: number };
}
export interface Stats {
  asOf: string; run: (RunWindow & { id: string }) | null; sources: Source[]; excluded: Source[];
  totals: Figures; bySource: Record<string, Figures>;
}

const USDC_DECIMALS = 6n;
export function sandboxUsd(units: string): string {
  const value = BigInt(units), scale = 10n ** USDC_DECIMALS;
  return `${value / scale}.${(value % scale).toString().padStart(Number(USDC_DECIMALS), '0')}`;
}

const seconds = (value: unknown) => (value === null || value === undefined ? null : Math.round(Number(value) * 1000) / 1000);

function figures(row: Record<string, unknown> | undefined, uploads: Record<string, unknown> | undefined): Figures {
  const units = String(row?.volume ?? '0');
  return {
    paymentsAccepted: Number(uploads?.accepted ?? 0), paymentsPending: Number(uploads?.pending ?? 0),
    paymentsSettled: Number(row?.settled ?? 0), settledVolumeUnits: units, settledVolumeSandboxUsd: sandboxUsd(units),
    doubleSpendsRefused: Number(row?.double_spends ?? 0), failedOnChain: Number(row?.failed ?? 0),
    settledAfterUploadSeconds: { p50: seconds(row?.settle_p50), p95: seconds(row?.settle_p95), n: Number(row?.settled ?? 0) },
    heldOfflineSeconds: { median: seconds(row?.held_median), n: Number(row?.timed ?? 0) },
    receiptToSettlementSeconds: { median: seconds(row?.receipt_median), n: Number(row?.timed ?? 0) },
  };
}

export async function computeStats(db: Database, options: { includeAll?: boolean; run?: RunWindow & { id: string } }): Promise<Stats> {
  const excluded = options.includeAll ? [] : [...EXCLUDED_BY_DEFAULT];
  const sources = SOURCES.filter(source => !excluded.includes(source));
  const { rows } = await db.query<Record<string, unknown>>(`SELECT source,
      COUNT(*) FILTER (WHERE status = 'settled') AS settled,
      COALESCE(SUM(amount_units) FILTER (WHERE status = 'settled'), 0)::text AS volume,
      COUNT(*) FILTER (WHERE status = 'failed' AND error = 'SerialUsed') AS double_spends,
      COUNT(*) FILTER (WHERE status = 'failed') AS failed,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY block_time - uploaded_at) FILTER (WHERE status = 'settled') AS settle_p50,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY block_time - uploaded_at) FILTER (WHERE status = 'settled') AS settle_p95,
      COUNT(*) FILTER (WHERE status = 'settled' AND received_at IS NOT NULL) AS timed,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY uploaded_at - received_at)
        FILTER (WHERE status = 'settled' AND received_at IS NOT NULL) AS held_median,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY block_time - received_at)
        FILTER (WHERE status = 'settled' AND received_at IS NOT NULL) AS receipt_median
    FROM payment_events
    WHERE source = ANY($1::text[]) AND ($2::bigint IS NULL OR uploaded_at >= $2) AND ($3::bigint IS NULL OR uploaded_at <= $3)
    GROUP BY ROLLUP(source)`, [sources, options.run?.from ?? null, options.run?.to ?? null]);
  // Accepted counts every upload the settlement journal holds; pending is the part with no decided event yet.
  const { rows: uploads } = await db.query<Record<string, unknown>>(`SELECT u.source,
      COUNT(*) AS accepted, COUNT(*) FILTER (WHERE e.note_id IS NULL) AS pending
    FROM payment_uploads u LEFT JOIN payment_events e ON e.note_id = u.note_id
    WHERE u.source = ANY($1::text[]) AND ($2::bigint IS NULL OR u.uploaded_at >= $2) AND ($3::bigint IS NULL OR u.uploaded_at <= $3)
    GROUP BY ROLLUP(u.source)`, [sources, options.run?.from ?? null, options.run?.to ?? null]);
  const pick = (list: Record<string, unknown>[], source: string | null) => list.find(row => row.source === source);
  const bySource: Record<string, Figures> = {};
  for (const source of sources) bySource[source] = figures(pick(rows, source), pick(uploads, source));
  // ROLLUP's grand-total row has a null source; with no rows at all there is no total row.
  return { asOf: new Date().toISOString(), run: options.run ?? null, sources, excluded,
    totals: figures(pick(rows, null), pick(uploads, null)), bySource };
}
