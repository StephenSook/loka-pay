import type { Database } from './store.js';

export interface AllowanceRateLimit { limit: number; windowSeconds: number }
// Operational default, configurable by the server owner. Counts validated POST uploads, including repeats.
export const DEFAULT_NOTE_RATE_LIMIT: Readonly<AllowanceRateLimit> = Object.freeze({ limit: 60, windowSeconds: 60 });

export function validateRateLimit(policy: AllowanceRateLimit): void {
  if (!Number.isSafeInteger(policy.limit) || policy.limit < 1 || policy.limit > 2147483646
    || !Number.isSafeInteger(policy.windowSeconds) || policy.windowSeconds < 1 || policy.windowSeconds > 86400) {
    throw new Error('Allowance rate limit requires a positive count and a window of at most one day');
  }
}

export async function migrateRateLimit(db: Database): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS settlement_rate_limits (
    allowance_key text PRIMARY KEY, window_start bigint NOT NULL, used integer NOT NULL CHECK(used>0)
  )`);
}

export async function admitSubmission(db: Database, key: string, policy: AllowanceRateLimit, testTime?: number): Promise<number | null> {
  const result = await db.query(`WITH clock AS (
      SELECT FLOOR(COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp())))::bigint AS now
    ), tick AS (SELECT now,(now/$3::bigint)*$3::bigint AS start FROM clock), admission AS (
      INSERT INTO settlement_rate_limits(allowance_key,window_start,used)
      SELECT $1,start,1 FROM tick
      ON CONFLICT(allowance_key) DO UPDATE SET window_start=GREATEST(settlement_rate_limits.window_start,EXCLUDED.window_start),
        used=CASE WHEN settlement_rate_limits.window_start<EXCLUDED.window_start THEN 1
          ELSE LEAST(settlement_rate_limits.used+1,$2::integer+1) END
      RETURNING used,window_start
    ) SELECT used, GREATEST(1,window_start+$3::bigint-tick.now)::integer AS retry FROM admission,tick`,
  [key, policy.limit, policy.windowSeconds, testTime ?? null]);
  const row = result.rows[0];
  return Number(row.used) <= policy.limit ? null : Number(row.retry);
}
