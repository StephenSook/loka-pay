import { afterEach, expect, test } from 'vitest';
import { SettlementStore } from './store.js';
import { RegistrationStore } from '../remit/store.js';
import { testDatabase } from './test-database.js';
import type { Job } from '../remit/types.js';

const close: (() => Promise<void>)[] = [];
afterEach(async () => { while (close.length) await close.pop()!(); });
const attempt = { signature: 'saved', rawTransaction: 'test', blockhash: 'test', lastValidBlockHeight: 100 };

test('note tokens fence stale writes even while the new owner lease is live', async () => {
  const db = await testDatabase(); close.push(() => db.close());
  let now = 100; const store = new SettlementStore(db, () => now); await store.migrate();
  const row = { noteId: 'a'.repeat(64), note: 'test', ack: null, uploadedAt: now };
  const old = (await store.claim(row))!; now = 130; const current = (await store.claim(row))!;
  const active = await db.query<{ expiry: number }>('SELECT lease_expires_at AS expiry FROM settlement_attempts');
  expect(Number(active.rows[0].expiry)).toBeGreaterThan(now);
  expect(old).not.toBe(current);
  expect(await store.saveAttempt(row.noteId, attempt, old)).toBe(false);
  expect(await store.releaseUnsigned(row.noteId, old)).toBe(false);
  expect(await store.saveAttempt(row.noteId, attempt, current)).toBe(true);
});

test('registration tokens fence save, budget and release while the new lease is live', async () => {
  const db = await testDatabase(); close.push(() => db.close());
  let now = 100; const store = new RegistrationStore(db, 'fence', () => now); await store.migrate();
  const cost = { units: '1', funderLamports: '1', feeLamports: '1' };
  const job: Job = { id: 'job', plan: { kind: 'payer', publicKey: 'test', keyHash: 'a'.repeat(64), pool: 'public', expiry: 1000,
    policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0', lifetimeSeconds: 1000, earmarks: [], daily: cost } }, attempt: null, result: null };
  const old = (await store.claim(job, now))!; now = 130; const current = (await store.claim(job, now))!;
  const active = await db.query<{ expiry: number }>('SELECT lease_expires_at AS expiry FROM registration_jobs');
  expect(Number(active.rows[0].expiry)).toBeGreaterThan(now);
  expect(await store.reserve('public', '2026-10-10', cost, cost, { id: job.id, token: old })).toBe(false);
  expect(await store.releaseUnsigned(job.id, old)).toBe(false);
  expect(await store.saveAttempt(job, job.plan, attempt, old)).toBe(false);
  expect(await store.saveAttempt(job, job.plan, attempt, current)).toBe(true);
  expect(await store.history(job)).toHaveLength(1);
  job.attempt = attempt; now = 160;
  const recoveryOld = (await store.claimRecovery(job))!; now = 190;
  const recoveryNew = (await store.claimRecovery(job))!;
  const replacement = { ...attempt, signature: 'replacement' };
  expect(await store.saveRecovery(job, replacement, recoveryOld)).toBe(false);
  expect(await store.saveRecovery(job, replacement, recoveryNew)).toBe(true);
});

test('a superseded retry token cannot restore the old failure or finish a new attempt', async () => {
  const db = await testDatabase(); close.push(() => db.close());
  let now = 100; const store = new RegistrationStore(db, 'retry-fence', () => now); await store.migrate();
  const cost = { units: '1', funderLamports: '1', feeLamports: '1' };
  const job: Job = { id: 'retry-job', plan: { kind: 'payer', publicKey: 'test', keyHash: 'b'.repeat(64), pool: 'public', expiry: 1000,
    policy: { capUnits: '1', offlineLimitUnits: '1', bondUnits: '0', lifetimeSeconds: 1000, earmarks: [], daily: cost } }, attempt: null, result: null };
  const original = (await store.claim(job, now))!;
  expect(await store.saveAttempt(job, job.plan, attempt, original)).toBe(true); job.attempt = attempt;
  const failure = { statusCode: 409 as const, body: { retryable: true, retryOf: attempt.signature } };
  await store.finish(job, failure);
  const old = (await store.claimFailedRetry(job, attempt.signature))!;
  now = 130; const current = (await store.claim(job, now))!;
  const active = await db.query<{ expiry: number }>('SELECT lease_expires_at AS expiry FROM registration_jobs');
  expect(Number(active.rows[0].expiry)).toBeGreaterThan(now);
  expect(await store.cancelUnsignedRetry(job.id, old)).toBe(false);
  const replacement = { ...attempt, signature: 'retry-replacement' };
  const unsigned = await store.get('payer', job.plan.keyHash);
  expect(await store.saveAttempt(unsigned, unsigned.plan, replacement, current)).toBe(true);
  await expect(store.finish(job, failure)).rejects.toThrow('Registration result was not saved');
  expect((await store.get('payer', job.plan.keyHash)).result).toBeNull();
  expect((await store.get('payer', job.plan.keyHash)).attempt?.signature).toBe(replacement.signature);
});
