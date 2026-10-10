import type { Database } from '../settle/store.js';
import type { PreparedAttempt } from '../settle/types.js';
import type { Cost, Job, Kind, PoolName, RegistrationPlan, Result } from './types.js';

export class RegistrationStore {
  constructor(private readonly db: Database, private readonly namespace: string) {}
  async migrate(): Promise<void> {
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_jobs (
      namespace text NOT NULL, kind text NOT NULL, key_hash text NOT NULL,
      id text NOT NULL UNIQUE, plan jsonb NOT NULL, attempt jsonb, result jsonb,
      PRIMARY KEY(namespace,kind,key_hash))`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_attempts (
        job_id text NOT NULL, signature text NOT NULL, plan jsonb NOT NULL, attempt jsonb NOT NULL,
        PRIMARY KEY(job_id,signature))`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_budgets (
        namespace text NOT NULL, pool text NOT NULL, day text NOT NULL,
        units numeric NOT NULL CHECK(units>=0), funder numeric NOT NULL CHECK(funder>=0),
        fee numeric NOT NULL CHECK(fee>=0), limits jsonb NOT NULL,
        PRIMARY KEY(namespace,pool,day))`);
  }
  async claim(job: Job, now: number): Promise<boolean> {
    const result = await this.db.query(`INSERT INTO registration_jobs(namespace,kind,key_hash,id,plan)
      VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT(namespace,kind,key_hash) DO UPDATE
      SET id=EXCLUDED.id,plan=EXCLUDED.plan,attempt=NULL,result=NULL
      WHERE registration_jobs.kind='payer' AND registration_jobs.result->>'statusCode' IN ('200','201')
        AND (registration_jobs.plan->>'expiry')::bigint <= $6 RETURNING id`,
    [this.namespace, job.plan.kind, job.plan.keyHash, job.id, JSON.stringify(job.plan), now]);
    return result.rows.length === 1;
  }
  async get(kind: Kind, keyHash: string): Promise<Job> {
    const { rows } = await this.db.query('SELECT id,plan,attempt,result FROM registration_jobs WHERE namespace=$1 AND kind=$2 AND key_hash=$3',
      [this.namespace, kind, keyHash]);
    if (!rows[0]) throw new Error('Registration claim missing');
    return rows[0] as unknown as Job;
  }
  async releaseUnsigned(id: string): Promise<void> {
    await this.db.query('DELETE FROM registration_jobs WHERE namespace=$1 AND id=$2 AND attempt IS NULL AND result IS NULL', [this.namespace, id]);
  }
  async reserve(pool: PoolName, day: string, cost: Cost, limits: Cost): Promise<boolean> {
    for (const value of [...Object.values(cost), ...Object.values(limits)]) {
      if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n) throw new Error('Invalid budget units');
    }
    // One row owns all three counters. PostgreSQL rechecks the WHERE under the row lock.
    // This single statement is atomic on pg.Pool too, without a connection-bound transaction.
    const result = await this.db.query(`INSERT INTO registration_budgets(namespace,pool,day,units,funder,fee,limits)
      SELECT $1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::jsonb
      WHERE $4::numeric <= ($7::jsonb->>'units')::numeric
        AND $5::numeric <= ($7::jsonb->>'funderLamports')::numeric
        AND $6::numeric <= ($7::jsonb->>'feeLamports')::numeric
      ON CONFLICT(namespace,pool,day) DO UPDATE SET units=registration_budgets.units+EXCLUDED.units,
        funder=registration_budgets.funder+EXCLUDED.funder,fee=registration_budgets.fee+EXCLUDED.fee
      WHERE registration_budgets.limits=EXCLUDED.limits
        AND registration_budgets.units+EXCLUDED.units <= ($7::jsonb->>'units')::numeric
        AND registration_budgets.funder+EXCLUDED.funder <= ($7::jsonb->>'funderLamports')::numeric
        AND registration_budgets.fee+EXCLUDED.fee <= ($7::jsonb->>'feeLamports')::numeric RETURNING pool`,
    [this.namespace, pool, day, cost.units, cost.funderLamports, cost.feeLamports, JSON.stringify(limits)]);
    return result.rows.length === 1;
  }
  async spent(pool: PoolName, day: string): Promise<Cost | null> {
    const { rows } = await this.db.query(`SELECT units::text AS units,funder::text AS "funderLamports",fee::text AS "feeLamports"
      FROM registration_budgets WHERE namespace=$1 AND pool=$2 AND day=$3`, [this.namespace, pool, day]);
    return (rows[0] as unknown as Cost) ?? null;
  }
  async saveAttempt(job: Job, plan: RegistrationPlan, attempt: PreparedAttempt): Promise<void> {
    const { rows } = await this.db.query(`WITH saved AS (
      UPDATE registration_jobs SET plan=$3::jsonb,attempt=$4::jsonb
      WHERE namespace=$1 AND id=$2 AND result IS NULL AND (attempt->>'signature') IS NOT DISTINCT FROM $5
      RETURNING id,plan,attempt)
      INSERT INTO registration_attempts(job_id,signature,plan,attempt)
      SELECT id,$6,plan,attempt FROM saved RETURNING job_id`,
    [this.namespace, job.id, JSON.stringify(plan), JSON.stringify(attempt), job.attempt?.signature ?? null, attempt.signature]);
    if (rows.length !== 1) throw new Error('Registration attempt was not saved');
  }
  async finish(job: Job, result: Result): Promise<Result> {
    await this.db.query(`UPDATE registration_jobs SET result=$3::jsonb WHERE namespace=$1 AND id=$2 AND result IS NULL`,
      [this.namespace, job.id, JSON.stringify(result)]);
    const saved = await this.get(job.plan.kind, job.plan.keyHash);
    if (saved.id !== job.id || !saved.result) throw new Error('Registration result was not saved');
    return saved.result;
  }
}
