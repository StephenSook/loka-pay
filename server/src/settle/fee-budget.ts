import { base58 } from '@scure/base';
import type { Database } from './store.js';

export interface FeeBudget { feePayer: string; dailyLamports: string }
const units = (value: string) => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)
  && BigInt(value) <= (1n << 64n) - 1n;
export function validateFeeBudget(policy: FeeBudget): void {
  if (!policy || !units(policy.dailyLamports) || base58.decode(policy.feePayer).length !== 32
    || base58.encode(base58.decode(policy.feePayer)) !== policy.feePayer) throw new Error('Invalid settlement fee budget');
}
export async function migrateFeeBudget(db: Database): Promise<void> {
  await db.query(`CREATE TABLE IF NOT EXISTS settlement_fee_budgets (
    fee_payer text NOT NULL, day text NOT NULL, spent numeric NOT NULL CHECK(spent>=0),
    daily_limit numeric NOT NULL CHECK(daily_limit>=0), PRIMARY KEY(fee_payer,day))`);
}
export async function reserveFee(db: Database, noteId: string, policy: FeeBudget, cost: string,
  owner: { token?: string; originalSignature?: string }, clock?: number): Promise<boolean> {
  validateFeeBudget(policy);
  if (!units(cost) || cost === '0') throw new Error('Invalid settlement fee quote');
  // Lock the claim and admit the fee in one statement, including on pg.Pool without session transactions.
  const { rows } = await db.query(`WITH instant AS (
    SELECT COALESCE($7::double precision,EXTRACT(EPOCH FROM clock_timestamp())) AS now), owner AS (
    SELECT note_id FROM settlement_attempts,instant WHERE note_id=$1 AND decision IS NULL
      AND (($5::text IS NOT NULL AND claim_token=$5 AND attempt IS NULL AND lease_expires_at>instant.now)
        OR ($6::text IS NOT NULL AND attempt->>'signature'=$6 AND replacement IS NULL)) FOR UPDATE)
    INSERT INTO settlement_fee_budgets(fee_payer,day,spent,daily_limit)
    SELECT $2,to_char(to_timestamp(instant.now) AT TIME ZONE 'UTC','YYYY-MM-DD'),$3::numeric,$4::numeric
    FROM instant WHERE EXISTS(SELECT note_id FROM owner) AND $3::numeric<=$4::numeric
    ON CONFLICT(fee_payer,day) DO UPDATE SET spent=settlement_fee_budgets.spent+EXCLUDED.spent
    WHERE settlement_fee_budgets.daily_limit=EXCLUDED.daily_limit
      AND settlement_fee_budgets.spent+EXCLUDED.spent<=EXCLUDED.daily_limit RETURNING fee_payer`,
  [noteId, policy.feePayer, cost, policy.dailyLamports, owner.token ?? null, owner.originalSignature ?? null, clock ?? null]);
  return rows.length === 1;
}
