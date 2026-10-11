import type { Database } from '../settle/store.js';

// Task 3.58: GET /api/wiring. One row per integration this server can see, each with the time of its last real
// success and evidence read from a stored row (never a constant), plus a stale window so /judge and /proof can grey
// a row out ("no event in N min"). Evidence is public chain data only: no key, key hash, IP or phone.
// ElevenLabs and Vonage run in the web app (/call) and the iMessage worker (3.47) is not built, so their rows
// belong to whichever service records their events.

export interface WiringRow {
  id: string; label: string; lastSuccessAt: number | null;
  /** What lastSuccessAt measures: the confirmed block time, or the time the server accepted the request
   *  (registration and remittance jobs store no confirmation time; the success follows within seconds). */
  timeBasis: 'block_time' | 'request_time';
  ageSeconds: number | null;
  staleAfterSeconds: number; stale: boolean; evidence: Record<string, string | number> | null;
}
export interface Wiring { asOf: string; commit: string; rows: WiringRow[] }

interface Source {
  id: string; label: string; staleAfterSeconds: number; timeBasis: WiringRow['timeBasis'];
  /** The table the row reads; a module that is not installed reports no success instead of failing the endpoint. */
  table: string;
  /** Returns the newest success as { at, ...evidence }, or nothing. `at` is unix seconds. */
  read(db: Database): Promise<Record<string, unknown> | undefined>;
}

const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
const tableExists = async (db: Database, name: string) =>
  (await db.query<{ found: boolean }>('SELECT to_regclass($1) IS NOT NULL AS found', [name])).rows[0]?.found === true;

// Registration and remittance rows keep no creation time; their plans store expiry = creation + lifetime.
const createdAt = `(plan->>'expiry')::bigint - (plan->'policy'->>'lifetimeSeconds')::bigint`;

const SOURCES: Source[] = [
  {
    id: 'solana_settlement', label: 'Solana devnet: a payment note settled or refused on chain', staleAfterSeconds: 30 * 60,
    table: 'payment_events', timeBasis: 'block_time',
    read: async db => (await db.query(`SELECT block_time::float8 AS at, slot::float8 AS slot, signature, status, source
      FROM payment_events ORDER BY block_time DESC, seq DESC LIMIT 1`)).rows[0],
  },
  {
    id: 'solana_registration', label: 'Solana devnet: an allowance or merchant record opened', staleAfterSeconds: 60 * 60,
    table: 'registration_jobs', timeBasis: 'request_time',
    read: async db => (await db.query(`SELECT ${createdAt} AS at, kind,
        COALESCE(result->'body'->>'openSignature', result->'body'->>'registerSignature') AS signature
      FROM registration_jobs WHERE result->>'statusCode' IN ('200', '201')
        AND COALESCE(result->'body'->>'openSignature', result->'body'->>'registerSignature') IS NOT NULL
        -- Only the job's own transaction: a merchant already on chain is adopted with an empty rawTransaction and
        -- an old signature, which would pair a fresh request time with someone else's success.
        AND COALESCE(attempt->>'rawTransaction', '') <> ''
      ORDER BY ${createdAt} DESC LIMIT 1`)).rows[0],
  },
  {
    id: 'remittance', label: 'Sandbox /send: a remittance allowance funded on devnet', staleAfterSeconds: 2 * 60 * 60,
    table: 'remittance_jobs', timeBasis: 'request_time',
    read: async db => (await db.query(`SELECT ${createdAt} AS at, result->'body'->>'signature' AS signature
      FROM remittance_jobs WHERE result->>'statusCode' IN ('200', '201') AND result->'body'->>'signature' IS NOT NULL
      ORDER BY ${createdAt} DESC LIMIT 1`)).rows[0],
  },
];

export async function computeWiring(db: Database, options: { commit: string; now?: () => number }): Promise<Wiring> {
  const now = Math.floor((options.now ?? (() => Date.now() / 1000))());
  const rows: WiringRow[] = [];
  for (const source of SOURCES) {
    const found = await tableExists(db, source.table) ? await source.read(db) : undefined;
    const at = found?.at === undefined || found?.at === null ? null : Number(found.at);
    let evidence: Record<string, string | number> | null = null;
    if (found && at !== null) {
      const { at: _at, ...rest } = found;
      evidence = {};
      for (const [key, value] of Object.entries(rest)) if (value !== null && value !== undefined) evidence[key] = typeof value === 'number' ? value : String(value);
      if (typeof evidence.signature === 'string') evidence.explorer = explorer(evidence.signature);
    }
    const ageSeconds = at === null ? null : Math.max(0, now - at);
    rows.push({ id: source.id, label: source.label, lastSuccessAt: at, timeBasis: source.timeBasis, ageSeconds, staleAfterSeconds: source.staleAfterSeconds,
      stale: ageSeconds === null || ageSeconds > source.staleAfterSeconds, evidence });
  }
  return { asOf: new Date(now * 1000).toISOString(), commit: options.commit, rows };
}
