import { BroadcastLease } from '../settle/broadcast.js';
import { randomUUID } from 'node:crypto';
import type { Database } from '../settle/store.js';
import type { PreparedAttempt } from '../settle/types.js';
import type { Cost, Job, Kind, PoolName, RegistrationPlan, Result } from './types.js';

export class RegistrationStore {
  // Production leases use the shared database clock. Override only for deterministic local tests.
  constructor(private readonly db: Database, private readonly namespace: string, private readonly clock?: () => number) {}
  async broadcast(job: Job, attempt: PreparedAttempt, send: (attempt: PreparedAttempt) => Promise<void>): Promise<boolean> {
    return new BroadcastLease(this.db, this.clock).send(`registration:${this.namespace}:${job.id}`, attempt, send);
  }
  async migrate(): Promise<void> {
    await new BroadcastLease(this.db, this.clock).migrate();
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_jobs (
      namespace text NOT NULL, kind text NOT NULL, key_hash text NOT NULL,
      id text NOT NULL UNIQUE, plan jsonb NOT NULL, attempt jsonb, result jsonb,
      PRIMARY KEY(namespace,kind,key_hash))`);
    await this.db.query('ALTER TABLE registration_jobs ADD COLUMN IF NOT EXISTS retry_parent jsonb');
    await this.db.query('ALTER TABLE registration_jobs ADD COLUMN IF NOT EXISTS explicit_retries integer NOT NULL DEFAULT 0');
    await this.db.query('ALTER TABLE registration_jobs ADD COLUMN IF NOT EXISTS recovery_used boolean NOT NULL DEFAULT false');
    await this.db.query('ALTER TABLE registration_jobs ADD COLUMN IF NOT EXISTS claim_token text');
    await this.db.query('ALTER TABLE registration_jobs ADD COLUMN IF NOT EXISTS lease_expires_at double precision');
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_attempts (
        job_id text NOT NULL, signature text NOT NULL, plan jsonb NOT NULL, attempt jsonb NOT NULL,
        PRIMARY KEY(job_id,signature))`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS registration_budgets (
        namespace text NOT NULL, pool text NOT NULL, day text NOT NULL,
        units numeric NOT NULL CHECK(units>=0), funder numeric NOT NULL CHECK(funder>=0),
        fee numeric NOT NULL CHECK(fee>=0), limits jsonb NOT NULL,
        PRIMARY KEY(namespace,pool,day))`);
  }
  async claim(job: Job, now: number): Promise<string | null> {
    const token = randomUUID();
    const result = await this.db.query(`INSERT INTO registration_jobs
      (namespace,kind,key_hash,id,plan,claim_token,lease_expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$7,COALESCE($8::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30)
      ON CONFLICT(namespace,kind,key_hash) DO UPDATE
      SET id=CASE WHEN registration_jobs.result IS NULL THEN registration_jobs.id ELSE EXCLUDED.id END,
        plan=CASE WHEN registration_jobs.result IS NULL THEN registration_jobs.plan ELSE EXCLUDED.plan END,
        attempt=NULL,result=NULL,recovery_used=false,explicit_retries=CASE WHEN registration_jobs.result IS NULL THEN registration_jobs.explicit_retries ELSE 0 END,claim_token=EXCLUDED.claim_token,lease_expires_at=EXCLUDED.lease_expires_at
      WHERE (registration_jobs.attempt IS NULL AND registration_jobs.result IS NULL
          AND COALESCE(registration_jobs.lease_expires_at,0)<=EXCLUDED.lease_expires_at-30)
        OR (registration_jobs.kind='payer' AND registration_jobs.result->>'statusCode' IN ('200','201')
          AND (registration_jobs.plan->>'expiry')::bigint < $6) RETURNING id`,
    [this.namespace, job.plan.kind, job.plan.keyHash, job.id, JSON.stringify(job.plan), now, token, this.clock?.() ?? null]);
    return result.rows.length === 1 ? token : null;
  }
  async get(kind: Kind, keyHash: string): Promise<Job> {
    const { rows } = await this.db.query('SELECT id,plan,attempt,result,explicit_retries AS "explicitRetries" FROM registration_jobs WHERE namespace=$1 AND kind=$2 AND key_hash=$3',
      [this.namespace, kind, keyHash]);
    if (!rows[0]) throw new Error('Registration claim missing');
    return rows[0] as unknown as Job;
  }
  async releaseUnsigned(id: string, token: string): Promise<boolean> {
    const { rows } = await this.db.query(`DELETE FROM registration_jobs
      WHERE namespace=$1 AND id=$2 AND claim_token=$3 AND attempt IS NULL AND result IS NULL AND retry_parent IS NULL
        AND lease_expires_at>COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp())) RETURNING id`,
    [this.namespace, id, token, this.clock?.() ?? null]);
    return rows.length === 1;
  }
  async cancelUnsignedRetry(id: string, token: string): Promise<boolean> {
    const { rows } = await this.db.query(`UPDATE registration_jobs
      SET attempt=retry_parent->'attempt',result=retry_parent->'result',
        explicit_retries=explicit_retries-1,retry_parent=NULL
      WHERE namespace=$1 AND id=$2 AND claim_token=$3 AND attempt IS NULL AND result IS NULL AND retry_parent IS NOT NULL
        AND lease_expires_at>COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp())) RETURNING id`,
    [this.namespace, id, token, this.clock?.() ?? null]);
    return rows.length === 1;
  }
  async reserve(pool: PoolName, day: string, cost: Cost, limits: Cost, owner?: { id: string; token: string; liveLease?: boolean }): Promise<boolean> {
    for (const value of [...Object.values(cost), ...Object.values(limits)]) {
      if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n) throw new Error('Invalid budget units');
    }
    // One row owns all three counters. PostgreSQL rechecks the WHERE under the row lock.
    // This single statement is atomic on pg.Pool too, without a connection-bound transaction.
    const result = await this.db.query(`WITH owner AS (
      SELECT id FROM registration_jobs WHERE namespace=$1 AND id=$8 AND claim_token=$9 AND result IS NULL
        AND (NOT $11::boolean OR lease_expires_at>COALESCE($10::double precision,EXTRACT(EPOCH FROM clock_timestamp())))
        AND (attempt IS NOT NULL OR lease_expires_at>COALESCE($10::double precision,EXTRACT(EPOCH FROM clock_timestamp())))
      FOR UPDATE)
      INSERT INTO registration_budgets(namespace,pool,day,units,funder,fee,limits)
      SELECT $1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7::jsonb
      WHERE ($8::text IS NULL OR EXISTS(SELECT id FROM owner))
        AND $4::numeric <= ($7::jsonb->>'units')::numeric
        AND $5::numeric <= ($7::jsonb->>'funderLamports')::numeric
        AND $6::numeric <= ($7::jsonb->>'feeLamports')::numeric
      ON CONFLICT(namespace,pool,day) DO UPDATE SET units=registration_budgets.units+EXCLUDED.units,
        funder=registration_budgets.funder+EXCLUDED.funder,fee=registration_budgets.fee+EXCLUDED.fee
      WHERE registration_budgets.limits=EXCLUDED.limits
        AND registration_budgets.units+EXCLUDED.units <= ($7::jsonb->>'units')::numeric
        AND registration_budgets.funder+EXCLUDED.funder <= ($7::jsonb->>'funderLamports')::numeric
        AND registration_budgets.fee+EXCLUDED.fee <= ($7::jsonb->>'feeLamports')::numeric RETURNING pool`,
    [this.namespace, pool, day, cost.units, cost.funderLamports, cost.feeLamports, JSON.stringify(limits),
      owner?.id ?? null, owner?.token ?? null, this.clock?.() ?? null, owner?.liveLease ?? false]);
    return result.rows.length === 1;
  }
  async spent(pool: PoolName, day: string): Promise<Cost | null> {
    const { rows } = await this.db.query(`SELECT units::text AS units,funder::text AS "funderLamports",fee::text AS "feeLamports"
      FROM registration_budgets WHERE namespace=$1 AND pool=$2 AND day=$3`, [this.namespace, pool, day]);
    return (rows[0] as unknown as Cost) ?? null;
  }
  async saveAttempt(job: Job, plan: RegistrationPlan, attempt: PreparedAttempt, token: string): Promise<boolean> {
    const { rows } = await this.db.query(`WITH saved AS (
      UPDATE registration_jobs SET plan=$3::jsonb,attempt=$4::jsonb,retry_parent=NULL
      WHERE namespace=$1 AND id=$2 AND result IS NULL AND claim_token=$7
        AND (attempt IS NOT NULL OR lease_expires_at>COALESCE($8::double precision,EXTRACT(EPOCH FROM clock_timestamp())))
        AND (attempt->>'signature') IS NOT DISTINCT FROM $5
      RETURNING id,plan,attempt)
      INSERT INTO registration_attempts(job_id,signature,plan,attempt)
      SELECT id,$6,plan,attempt FROM saved RETURNING job_id`,
    [this.namespace, job.id, JSON.stringify(plan), JSON.stringify(attempt), job.attempt?.signature ?? null, attempt.signature,
      token, this.clock?.() ?? null]);
    return rows.length === 1;
  }
  async claimFailedRetry(job: Job, signature: string): Promise<string | null> {
    const token = randomUUID();
    const { rows } = await this.db.query(`UPDATE registration_jobs SET attempt=NULL,result=NULL,
      explicit_retries=explicit_retries+1,recovery_used=false,claim_token=$4,
      retry_parent=jsonb_build_object('attempt',attempt,'result',result),
      plan=CASE WHEN kind='payer' AND (plan->>'expiry')::bigint<$6
        THEN jsonb_set(plan,'{expiry}',to_jsonb($6::bigint+(plan->'policy'->>'lifetimeSeconds')::bigint)) ELSE plan END,
      lease_expires_at=COALESCE($5::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30
      WHERE namespace=$1 AND id=$2 AND attempt->>'signature'=$3 AND result->'body'->>'retryOf'=$3
        AND result->'body'->>'retryable'='true' AND explicit_retries<1 RETURNING id`,
    [this.namespace, job.id, signature, token, this.clock?.() ?? null, Math.floor(this.clock?.() ?? Date.now()/1000)]);
    return rows.length ? token : null;
  }
  async history(job: Job): Promise<{ plan: RegistrationPlan; attempt: PreparedAttempt }[]> {
    const { rows } = await this.db.query('SELECT plan,attempt FROM registration_attempts WHERE job_id=$1', [job.id]);
    return rows as unknown as { plan: RegistrationPlan; attempt: PreparedAttempt }[];
  }
  async claimRecovery(job: Job): Promise<string | null> {
    const token = randomUUID();
    const { rows } = await this.db.query(`UPDATE registration_jobs SET claim_token=$4,
      lease_expires_at=COALESCE($5::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30
      WHERE namespace=$1 AND id=$2 AND attempt->>'signature'=$3 AND result IS NULL AND NOT recovery_used
        AND COALESCE(lease_expires_at,0)<=COALESCE($5::double precision,EXTRACT(EPOCH FROM clock_timestamp()))
      RETURNING id`, [this.namespace, job.id, job.attempt!.signature, token, this.clock?.() ?? null]);
    return rows.length ? token : null;
  }
  async saveRecovery(job: Job, attempt: PreparedAttempt, token: string): Promise<boolean> {
    const { rows } = await this.db.query(`WITH saved AS (
      UPDATE registration_jobs SET attempt=$4::jsonb,recovery_used=true
      WHERE namespace=$1 AND id=$2 AND attempt->>'signature'=$3 AND result IS NULL AND NOT recovery_used
        AND claim_token=$5 AND lease_expires_at>COALESCE($6::double precision,EXTRACT(EPOCH FROM clock_timestamp()))
      RETURNING id,plan,attempt)
      INSERT INTO registration_attempts(job_id,signature,plan,attempt)
      SELECT id,$7,plan,attempt FROM saved RETURNING job_id`,
    [this.namespace, job.id, job.attempt!.signature, JSON.stringify(attempt), token, this.clock?.() ?? null, attempt.signature]);
    return rows.length === 1;
  }
  async finish(job: Job, result: Result): Promise<Result> {
    const legacyFailure = result.statusCode === 409 && job.result?.statusCode === 409 && !('retryable' in job.result.body);
    await this.db.query(`UPDATE registration_jobs SET result=$3::jsonb WHERE namespace=$1 AND id=$2
      AND (result IS NULL OR ($5::boolean AND result->>'statusCode'='409' AND NOT (result->'body' ? 'retryable')))
      AND attempt->>'signature'=$4`,
      [this.namespace, job.id, JSON.stringify(result), job.attempt?.signature ?? null, legacyFailure]);
    const saved = await this.get(job.plan.kind, job.plan.keyHash);
    if (saved.id !== job.id || !saved.result) throw new Error('Registration result was not saved');
    return saved.result;
  }
}
