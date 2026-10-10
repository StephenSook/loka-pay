import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as P from '@lokapay/protocol';
import type { Database } from '../settle/store.js';
import type { PreparedAttempt } from '../settle/types.js';
import { HttpError } from '../settle/validation.js';
import type { CertificateSigner, Cost, Policy, RegistrationChain, RegistrationPlan, Result } from './types.js';

interface FundingRow { recipient: string; plan: RegistrationPlan; attempt: PreparedAttempt | null; result: Result | null }
export class BurstGuard {
  private readonly secret = randomBytes(32);
  private readonly entries = new Map<string, { count: number; expires: number }>();
  constructor(private readonly limit = 10, private readonly now = Date.now) {
    if (!Number.isSafeInteger(limit) || limit < 10) throw new Error('Burst guard must allow at least ten sends per hour');
  }
  admit(identifier: string): boolean {
    const now = this.now();
    for (const [key, value] of this.entries) if (value.expires <= now) this.entries.delete(key);
    const key = createHmac('sha256', this.secret).update(identifier).digest('hex');
    let row = this.entries.get(key);
    if (!row) {
      if (this.entries.size >= 10000) return false;
      row = { count: 0, expires: now + 3600000 }; this.entries.set(key, row);
    }
    if (row.count >= this.limit) return false;
    row.count++; return true;
  }
}
export class RemittanceStore {
  constructor(private readonly db: Database, private readonly namespace: string, private readonly clock?: () => number,
    private readonly budgetNamespace: string = namespace) {}
  async migrate() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS remittance_jobs(namespace text NOT NULL,recipient text NOT NULL,
      plan jsonb NOT NULL,attempt jsonb,result jsonb,claim_token text NOT NULL,lease_expires_at double precision NOT NULL,
      PRIMARY KEY(namespace,recipient))`);
    await this.db.query(`CREATE TABLE IF NOT EXISTS remittance_budgets(namespace text NOT NULL,day text NOT NULL,
      units numeric NOT NULL,funder numeric NOT NULL,fee numeric NOT NULL,limits jsonb NOT NULL,PRIMARY KEY(namespace,day))`);
  }
  async claim(recipient: string, plan: RegistrationPlan): Promise<string | null> {
    const token = randomUUID();
    const { rows } = await this.db.query(`INSERT INTO remittance_jobs(namespace,recipient,plan,claim_token,lease_expires_at)
      VALUES($1,$2,$3::jsonb,$4,COALESCE($5::double precision,EXTRACT(EPOCH FROM clock_timestamp()))+30)
      ON CONFLICT(namespace,recipient) DO UPDATE SET claim_token=EXCLUDED.claim_token,lease_expires_at=EXCLUDED.lease_expires_at,
        plan=CASE WHEN remittance_jobs.result IS NULL THEN remittance_jobs.plan ELSE EXCLUDED.plan END,attempt=NULL,result=NULL
      WHERE (remittance_jobs.attempt IS NULL AND remittance_jobs.result IS NULL AND remittance_jobs.lease_expires_at<=EXCLUDED.lease_expires_at-30)
        OR (remittance_jobs.result->>'statusCode' IN ('200','201') AND (remittance_jobs.plan->>'expiry')::bigint<EXCLUDED.lease_expires_at-30)
      RETURNING recipient`, [this.namespace, recipient, JSON.stringify(plan), token, this.clock?.() ?? null]);
    return rows.length ? token : null;
  }
  async get(recipient: string): Promise<FundingRow> {
    const { rows } = await this.db.query('SELECT recipient,plan,attempt,result FROM remittance_jobs WHERE namespace=$1 AND recipient=$2', [this.namespace, recipient]);
    if (!rows[0]) throw new Error('Missing remittance'); return rows[0] as unknown as FundingRow;
  }
  async reserve(recipient: string, token: string, cost: Cost, limits: Cost): Promise<boolean> {
    for (const value of [...Object.values(cost), ...Object.values(limits)]) if (!/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) > (1n << 64n) - 1n) throw new Error('Invalid remittance budget');
    const { rows } = await this.db.query(`WITH owner AS (SELECT recipient FROM remittance_jobs
      WHERE namespace=$1 AND recipient=$2 AND claim_token=$3 AND attempt IS NULL AND result IS NULL
        AND lease_expires_at>COALESCE($8::double precision,EXTRACT(EPOCH FROM clock_timestamp())) FOR UPDATE)
      INSERT INTO remittance_budgets(namespace,day,units,funder,fee,limits)
      SELECT $9,to_char(to_timestamp(COALESCE($8::double precision,EXTRACT(EPOCH FROM clock_timestamp()))) AT TIME ZONE 'UTC','YYYY-MM-DD'),$4::numeric,$5::numeric,$6::numeric,$7::jsonb
      WHERE EXISTS(SELECT recipient FROM owner) AND $4::numeric<=($7::jsonb->>'units')::numeric
        AND $5::numeric<=($7::jsonb->>'funderLamports')::numeric AND $6::numeric<=($7::jsonb->>'feeLamports')::numeric
      ON CONFLICT(namespace,day) DO UPDATE SET units=remittance_budgets.units+EXCLUDED.units,
        funder=remittance_budgets.funder+EXCLUDED.funder,fee=remittance_budgets.fee+EXCLUDED.fee
      WHERE remittance_budgets.limits=EXCLUDED.limits AND remittance_budgets.units+EXCLUDED.units<=($7::jsonb->>'units')::numeric
        AND remittance_budgets.funder+EXCLUDED.funder<=($7::jsonb->>'funderLamports')::numeric
        AND remittance_budgets.fee+EXCLUDED.fee<=($7::jsonb->>'feeLamports')::numeric RETURNING namespace`,
    [this.namespace, recipient, token, cost.units, cost.funderLamports, cost.feeLamports, JSON.stringify(limits), this.clock?.() ?? null, this.budgetNamespace]);
    return rows.length === 1;
  }
  async save(row: FundingRow, token: string, attempt: PreparedAttempt): Promise<boolean> {
    const { rows } = await this.db.query(`UPDATE remittance_jobs SET attempt=$4::jsonb WHERE namespace=$1 AND recipient=$2
      AND claim_token=$3 AND attempt IS NULL AND result IS NULL
      AND lease_expires_at>COALESCE($5::double precision,EXTRACT(EPOCH FROM clock_timestamp())) RETURNING recipient`,
    [this.namespace, row.recipient, token, JSON.stringify(attempt), this.clock?.() ?? null]);
    return rows.length === 1;
  }
  async release(recipient: string, token: string): Promise<void> {
    await this.db.query(`DELETE FROM remittance_jobs WHERE namespace=$1 AND recipient=$2 AND claim_token=$3 AND attempt IS NULL
      AND lease_expires_at>COALESCE($4::double precision,EXTRACT(EPOCH FROM clock_timestamp()))`, [this.namespace, recipient, token, this.clock?.() ?? null]);
  }
  async finish(row: FundingRow, result: Result): Promise<Result> {
    await this.db.query(`UPDATE remittance_jobs SET result=$4::jsonb WHERE namespace=$1 AND recipient=$2
      AND attempt->>'signature'=$3 AND result IS NULL`, [this.namespace, row.recipient, row.attempt!.signature, JSON.stringify(result)]);
    return (await this.get(row.recipient)).result!;
  }
}
export class RemittanceService {
  private readonly guard = new BurstGuard();
  constructor(private readonly options: { store: RemittanceStore; chain: RegistrationChain & { recipient(id: string): Promise<{ publicKey: string }> };
    signer: CertificateSigner; policy: Policy; now?: () => number }) {
    const p = options.policy;
    if (!/^[1-9][0-9]*$/.test(p.capUnits) || BigInt(p.capUnits) > 1000000n || p.bondUnits !== '0'
      || !Number.isSafeInteger(p.lifetimeSeconds) || p.lifetimeSeconds <= 0 || !p.earmarks.length || p.earmarks.length > 16) throw new Error('Remittance requires a nonempty existing earmark list, zero bond and at most one sandbox USDC');
    P.encodeEarmarks(p.earmarks.map(P.fromHex));
    if (p.earmarks.some((hash, n) => !/^[0-9a-f]{64}$/.test(hash) || (n > 0 && p.earmarks[n - 1] >= hash))) throw new Error('Existing earmarks must be sorted unique lowercase hashes');
    for (const amount of Object.values(p.daily)) if (!/^(0|[1-9][0-9]*)$/.test(amount) || BigInt(amount) > (1n << 64n) - 1n) throw new Error('Invalid remittance daily budget');
  }
  private pending(row: FundingRow): Result { return { statusCode: 202, body: { status: 'pending', recipientAllowanceId: row.recipient, signature: row.attempt?.signature ?? null, retryAfter: 2 } }; }
  private async resolve(row: FundingRow): Promise<Result> {
    if (row.result) return { ...row.result, statusCode: row.result.statusCode === 201 ? 200 : row.result.statusCode };
    if (!row.attempt) return this.pending(row);
    try {
      const outcome = await this.options.chain.observe(row.attempt, row.plan);
      if (outcome === null) return this.pending(row);
      if (outcome !== 'ok') return this.options.store.finish(row, { statusCode: 409, body: { error: 'remittance_failed', signature: row.attempt.signature } });
      const allow = await this.options.signer.allow({ allowanceId: BigInt(row.plan.allowanceId!), payerKeyHash: P.fromHex(row.plan.keyHash),
        cap: BigInt(row.plan.policy.capUnits), offlineLimit: BigInt(row.plan.policy.offlineLimitUnits), expiry: BigInt(row.plan.expiry),
        earmarkList: P.encodeEarmarks(row.plan.policy.earmarks.map(P.fromHex)), bond: 0n });
      return this.options.store.finish(row, { statusCode: 201, body: { recipientAllowanceId: row.recipient, allowanceId: row.plan.allowanceId,
        allow, earmarks: row.plan.policy.earmarks, signature: row.attempt.signature,
        explorer: `https://explorer.solana.com/tx/${row.attempt.signature}?cluster=devnet`, sandbox: true } });
    } catch { return this.pending(row); }
  }
  async submit(input: unknown, memoryOnlyNetworkIdentifier: string): Promise<Result> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'bad_json');
    const body = input as Record<string, unknown>;
    if (Object.keys(body).some(key => !['recipientAllowanceId', 'amountUnits'].includes(key)) || typeof body.recipientAllowanceId !== 'string'
      || !/^(0|[1-9][0-9]*)$/.test(body.recipientAllowanceId) || BigInt(body.recipientAllowanceId) >= 1n << 64n) throw new HttpError(400, 'bad_json');
    if (typeof body.amountUnits !== 'string' || !/^[1-9][0-9]*$/.test(body.amountUnits)
      || BigInt(body.amountUnits) > BigInt(this.options.policy.capUnits)) throw new HttpError(422, 'amount_cap');
    const identity = await this.options.chain.recipient(body.recipientAllowanceId);
    const publicKey = P.base64urlDecode(identity.publicKey), now = Math.floor((this.options.now ?? (() => Date.now() / 1000))());
    const policy = { ...this.options.policy, capUnits: body.amountUnits, offlineLimitUnits: body.amountUnits };
    let allowanceId: string | undefined;
    for (let n = 0; n < 8; n++) { const id = randomBytes(8).readBigUInt64BE().toString(); if (!await this.options.chain.taken(id)) { allowanceId = id; break; } }
    if (!allowanceId) throw new HttpError(503, 'chain_unavailable');
    const plan: RegistrationPlan = { kind: 'payer', pool: 'public', publicKey: identity.publicKey, keyHash: P.toHex(P.keyHash(publicKey)),
      allowanceId, policy, expiry: now + policy.lifetimeSeconds };
    const token = await this.options.store.claim(body.recipientAllowanceId, plan);
    const row = await this.options.store.get(body.recipientAllowanceId);
    if (!token) return this.resolve(row);
    if (!this.guard.admit(memoryOnlyNetworkIdentifier)) { await this.options.store.release(row.recipient, token); throw new HttpError(429, 'rate_limited', 3600); }
    let admitted = false;
    try {
      const quote = await this.options.chain.quote(row.plan);
      // Unknown reservation outcomes retain the claim. Admission is conservative and never refunded.
      admitted = true;
      if (!await this.options.store.reserve(row.recipient, token, quote.cost, row.plan.policy.daily)) {
        admitted = false; throw new HttpError(429, 'budget_exhausted');
      }
      const attempt = await this.options.chain.sign(quote, row.plan);
      if (!await this.options.store.save(row, token, attempt)) return this.resolve(await this.options.store.get(row.recipient));
      row.attempt = attempt;
      await this.options.chain.send(attempt);
      return this.resolve(row);
    } catch (error) {
      if (admitted) return this.pending(await this.options.store.get(row.recipient));
      await this.options.store.release(row.recipient, token);
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'chain_unavailable');
    }
  }
}
