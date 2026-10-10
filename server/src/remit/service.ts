import { randomBytes, randomUUID } from 'node:crypto';
import * as P from '@lokapay/protocol';
import { validateRegistration } from '../certs/validation.js';
import { HttpError } from '../settle/validation.js';
import { RegistrationStore } from './store.js';
import type { CertificateSigner, Job, Kind, Policy, PoolName, RegistrationChain, Result } from './types.js';

interface Options {
  store: RegistrationStore; chain: RegistrationChain; signer: CertificateSigner;
  teamKeys: string[]; policies: Record<PoolName, Policy>; now?: () => number;
}
export class RegistrationService {
  constructor(private readonly options: Options) {
    for (const hash of options.teamKeys) if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid team key hash');
    for (const policy of Object.values(options.policies)) {
      for (const amount of [policy.capUnits, policy.offlineLimitUnits, policy.bondUnits, ...Object.values(policy.daily)]) {
        if (!/^(0|[1-9][0-9]*)$/.test(amount) || BigInt(amount) > (1n << 64n) - 1n) throw new Error('Invalid policy amount');
      }
      if (BigInt(policy.capUnits) === 0n || BigInt(policy.offlineLimitUnits) > BigInt(policy.capUnits)
        || BigInt(policy.capUnits) + BigInt(policy.bondUnits) > (1n << 64n) - 1n
        || !Number.isSafeInteger(policy.lifetimeSeconds) || policy.lifetimeSeconds <= 0) throw new Error('Invalid allowance policy');
      P.encodeEarmarks(policy.earmarks.map(P.fromHex));
    }
  }
  private now(): number { return Math.floor((this.options.now ?? (() => Date.now() / 1000))()); }
  private pending(job: Job): Result {
    return { statusCode: 202, body: { status: 'pending', kind: job.plan.kind, keyHash: job.plan.keyHash,
      signature: job.attempt?.signature ?? null, retryAfter: 2 } };
  }
  async submit(kind: Kind, input: unknown): Promise<Result> {
    let retryOf: string | undefined;
    if (input && typeof input === 'object' && !Array.isArray(input) && 'retryOf' in input) {
      const { retryOf: requested, ...rest } = input as Record<string, unknown>;
      if (typeof requested !== 'string' || requested.length < 1 || requested.length > 128) throw new HttpError(400, 'bad_json');
      retryOf = requested; input = rest;
    }
    const request = validateRegistration(kind, input);
    const pool = this.options.teamKeys.includes(request.keyHash) ? 'team' : 'public';
    const policy = this.options.policies[pool]; const now = this.now();
    let job: Job = { id: randomUUID(), plan: { ...request, kind, pool, policy, expiry: now + policy.lifetimeSeconds },
      attempt: null, result: null };
    let token: string | null;
    if (retryOf) {
      let previous: Job;
      try { previous = await this.options.store.get(kind, request.keyHash); }
      catch { throw new HttpError(409, 'retry_not_available'); }
      token = await this.options.store.claimFailedRetry(previous, retryOf);
    } else token = await this.options.store.claim(job, now);
    if (!token) {
      const existing = await this.options.store.get(kind, request.keyHash);
      return this.resolve(existing, false);
    }
    // A takeover keeps the original name, pool, policy and expiry. Renewal has a new plan and job id.
    job = await this.options.store.get(kind, request.keyHash);
    // Only the fenced winner can save then send. Saved-attempt recovery has a separate lease.
    let reserved = false;
    try {
      if (kind === 'merchant') {
        const existing = await this.options.chain.existingMerchant(job.plan.publicKey);
        if (existing) {
          reserved = true;
          const attempt = { signature: existing, rawTransaction: '', blockhash: '', lastValidBlockHeight: 0 };
          if (!await this.options.store.saveAttempt(job, job.plan, attempt, token)) {
            return this.resolve(await this.options.store.get(kind, request.keyHash), false);
          }
          job.attempt = attempt;
          return await this.complete(job, existing, false);
        }
      }
      for (let tries = 0; tries < 8; tries++) {
        const plan = { ...job.plan };
        if (kind === 'payer') {
          plan.allowanceId = randomBytes(8).readBigUInt64BE().toString();
          if (await this.options.chain.taken(plan.allowanceId)) continue;
        }
        const quote = await this.options.chain.quote(plan);
        const day = new Date(this.now() * 1000).toISOString().slice(0, 10);
        // Mark uncertainty before the database call: a lost response may still have reserved funds.
        reserved = true;
        const admitted = await this.options.store.reserve(job.plan.pool, day, quote.cost, job.plan.policy.daily, { id: job.id, token });
        if (!admitted) {
          if (job.attempt) return this.failed(job, 'collision_budget_exhausted');
          reserved = false;
          throw new HttpError(429, 'budget_exhausted');
        }
        const attempt = await this.options.chain.sign(quote, plan);
        // The token and lease are checked in the same durable write as the signature history.
        if (!await this.options.store.saveAttempt(job, plan, attempt, token)) {
          return this.resolve(await this.options.store.get(kind, request.keyHash), false);
        }
        job.plan = plan; job.attempt = attempt;
        await this.options.store.broadcast(job, attempt, a => this.options.chain.send(a));
        const outcome = await this.options.chain.observe(attempt, plan);
        if (kind === 'payer' && outcome === 'collision') continue;
        return this.resolve(job, true, outcome);
      }
      if (reserved && job.attempt) return this.failed(job, 'collision_retry_exhausted');
      if (reserved) return this.pending(job);
      throw new HttpError(503, 'chain_unavailable');
    } catch (error) {
      if (reserved) {
        try {
          const current = await this.options.store.get(kind, request.keyHash);
          return current.result ?? this.pending(current);
        } catch { return this.pending(job); }
      }
      if (await this.options.store.cancelUnsignedRetry(job.id, token)) {
        return this.resolve(await this.options.store.get(kind, request.keyHash), false);
      }
      if (!await this.options.store.releaseUnsigned(job.id, token)) {
        return this.resolve(await this.options.store.get(kind, request.keyHash), false);
      }
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, 'chain_unavailable');
    }
  }
  private async recover(job: Job): Promise<Result> {
    // A prior transaction can supply the result even after a saved replacement was prepared.
    for (const saved of await this.options.store.history(job)) {
      if (saved.attempt.signature === job.attempt!.signature) continue;
      const prior = await this.options.chain.lookup(saved.attempt, saved.plan);
      if (prior.outcome === 'ok') return this.complete({ ...job, plan: saved.plan }, saved.attempt.signature, false);
      if (prior.found && prior.outcome === null) return this.pending(job);
    }
    const height = await this.options.chain.blockHeight();
    if (!Number.isSafeInteger(height) || height < 0) return this.pending(job);
    // Search history after observing height so an absent cached lookup cannot authorize a replacement.
    const current = await this.options.chain.lookup(job.attempt!, job.plan);
    if (current.outcome !== null) return this.resolve(job, false, current.outcome);
    if (current.found) return this.pending(job);
    if (height <= job.attempt!.lastValidBlockHeight) {
      await this.options.store.broadcast(job, job.attempt!, a => this.options.chain.send(a));
      return this.pending(job);
    }
    const token = await this.options.store.claimRecovery(job);
    if (!token) return this.pending(job);
    // An expired certificate plan cannot open a new allowance. Never silently change its terms.
    if (job.plan.kind === 'payer' && job.plan.expiry <= this.now()) return this.pending(job);
    const quote = await this.options.chain.quote(job.plan);
    if (quote.blockhash === job.attempt!.blockhash || quote.lastValidBlockHeight <= height) return this.pending(job);
    const latest = await this.options.chain.lookup(job.attempt!, job.plan);
    if (latest.outcome !== null) return this.resolve(job, false, latest.outcome);
    if (latest.found) return this.pending(job);
    const day = new Date(this.now() * 1000).toISOString().slice(0, 10);
    if (!await this.options.store.reserve(job.plan.pool, day, quote.cost, job.plan.policy.daily, { id: job.id, token, liveLease: true })) return this.pending(job);
    const attempt = await this.options.chain.sign(quote, job.plan);
    if (attempt.signature === job.attempt!.signature) return this.pending(job);
    if (!await this.options.store.saveRecovery(job, attempt, token)) return this.pending(job);
    job = { ...job, attempt };
    await this.options.store.broadcast(job, attempt, a => this.options.chain.send(a));
    return this.resolve(job, false);
  }
  private async failed(job: Job, reason: string): Promise<Result> {
    const signature = job.attempt!.signature;
    const retryable = (job.explicitRetries ?? 0) < 1;
    return this.options.store.finish(job, { statusCode: 409, body: {
      error: 'registration_failed', reason, retryable, retryOf: signature,
      message: retryable
        ? 'Registration failed on chain. Restore funding or wait for budget reset, then repost with retryOf set to this signature.'
        : 'The bounded registration retry is exhausted. Operator review is required.',
      signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    } });
  }
  private async complete(job: Job, signature: string, created: boolean): Promise<Result> {
    const p = job.plan;
    const explorer = `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
    const body = p.kind === 'payer' ? {
      allowanceId: p.allowanceId!, payerKeyHash: p.keyHash, pool: p.pool,
      capUnits: p.policy.capUnits, offlineLimitUnits: p.policy.offlineLimitUnits, bondUnits: p.policy.bondUnits,
      expiry: p.expiry, earmarks: p.policy.earmarks,
      allowance: await this.options.signer.allow({ allowanceId: BigInt(p.allowanceId!), payerKeyHash: P.fromHex(p.keyHash),
        cap: BigInt(p.policy.capUnits), offlineLimit: BigInt(p.policy.offlineLimitUnits), bond: BigInt(p.policy.bondUnits),
        expiry: BigInt(p.expiry), earmarkList: P.encodeEarmarks(p.policy.earmarks.map(P.fromHex)) }),
      openSignature: signature, explorer,
    } : { merchantKeyHash: p.keyHash, merchant: await this.options.signer.merchant({ merchantKeyHash: P.fromHex(p.keyHash),
      displayName: p.name! }), registerSignature: signature, explorer };
    const result = await this.options.store.finish(job, { statusCode: 200, body });
    return { ...result, statusCode: created ? 201 : 200 };
  }
  private async resolve(job: Job, created: boolean, known?: 'ok' | 'collision' | 'failed' | null): Promise<Result> {
    if (job.result) {
      if (job.result.statusCode === 409 && !('retryable' in job.result.body) && job.attempt) {
        try {
          const outcome = await this.options.chain.observe(job.attempt, job.plan);
          if (outcome === 'failed' || outcome === 'collision') return await this.failed(job, 'chain_failure');
        } catch { /* Keep the saved failure until its chain outcome can be checked. */ }
      }
      return job.result;
    }
    if (!job.attempt) return this.pending(job);
    try {
      const outcome = known === undefined ? await this.options.chain.observe(job.attempt, job.plan) : known;
      if (outcome === 'ok') return await this.complete(job, job.attempt.signature, created);
      if (outcome === 'collision' && job.plan.kind === 'merchant') {
        const existing = await this.options.chain.existingMerchant(job.plan.publicKey);
        if (existing) return await this.complete(job, existing, false);
      }
      if (outcome === 'failed') return await this.failed(job, 'chain_failure');
      if (outcome === 'collision') return await this.failed(job, 'allocation_collision');
      if (outcome === null) return await this.recover(job);
      return this.pending(job);
    } catch { return this.pending(job); }
  }
}
