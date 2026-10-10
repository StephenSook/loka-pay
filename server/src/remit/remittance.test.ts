import { afterEach, expect, test, vi } from 'vitest';
import { p256 } from '@noble/curves/nist.js';
import * as P from '@lokapay/protocol';
import { testDatabase } from '../settle/test-database.js';
import { RemittanceStore, RemittanceService, BurstGuard } from './remittance.js';
import type { RegistrationChain, RegistrationPlan, Policy } from './types.js';

const close: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (close.length) await close.pop()!(); });
const publicKey = P.base64urlEncode(p256.getPublicKey(new Uint8Array(32).fill(1)));
const earmark = 'ab'.repeat(32);
const policy: Policy = { capUnits: '1000000', offlineLimitUnits: '1000000', bondUnits: '0', lifetimeSeconds: 3600,
  earmarks: [earmark], daily: { units: '1000000', funderLamports: '10', feeLamports: '10' } };
async function fixture() {
  const db = await testDatabase(); close.push(() => db.close());
  const store = new RemittanceStore(db, 'fixture', () => 1800000000); await store.migrate();
  const chain = { recipient: vi.fn(async () => ({ publicKey })), taken: vi.fn(async () => false),
    quote: vi.fn(async (plan: RegistrationPlan) => ({ message: 'unsigned', blockhash: 'fixture', lastValidBlockHeight: 100,
      cost: { units: plan.policy.capUnits, funderLamports: '1', feeLamports: '1' } })),
    sign: vi.fn(async () => ({ signature: 'fixture-signature', rawTransaction: 'test', blockhash: 'fixture', lastValidBlockHeight: 100 })),
    send: vi.fn(async () => {}), observe: vi.fn(async (): Promise<'ok' | null> => 'ok') };
  const signer = { allow: vi.fn(async () => 'certificate'), merchant: vi.fn(async () => 'unused') };
  const service = new RemittanceService({ store, chain: chain as unknown as RegistrationChain & { recipient(id: string): Promise<{ publicKey: string }> }, signer, policy, now: () => 1800000000 });
  return { service, chain, store, db };
}
test('earmarked funding uses existing list, refuses amounts over the cap before signing', async () => {
  const f = await fixture();
  await expect(f.service.submit({ recipientAllowanceId: '1', amountUnits: '1000001' }, 'memory-only')).rejects.toMatchObject({ statusCode: 422 });
  expect(f.chain.sign).not.toHaveBeenCalled();
  const result = await f.service.submit({ recipientAllowanceId: '1', amountUnits: '1000000' }, 'memory-only');
  expect(result.statusCode).toBe(201); expect(f.chain.quote.mock.calls[0][0].policy.earmarks).toEqual([earmark]);
  expect(f.chain.quote.mock.calls[0][0].publicKey).toBe(publicKey);
});
test('one live remittance per recipient and atomic daily budget across concurrent recipients', async () => {
  const f = await fixture();
  const results = await Promise.allSettled(['1', '2'].map(recipientAllowanceId => f.service.submit({ recipientAllowanceId, amountUnits: '1000000' }, 'venue')));
  expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1); expect(f.chain.sign).toHaveBeenCalledTimes(1);
  expect(f.chain.quote.mock.calls[0][0].policy.bondUnits).toBe('0');
  const winner = results.findIndex(row => row.status === 'fulfilled');
  const repeated = await f.service.submit({ recipientAllowanceId: String(winner + 1), amountUnits: '1000000' }, 'venue');
  expect(repeated.statusCode).toBe(200);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
});
test('saved attempts stay pending on uncertain send without another signature or broadcast', async () => {
  const f = await fixture(); f.chain.send.mockRejectedValue(new Error('timeout')); f.chain.observe.mockResolvedValue(null);
  expect((await f.service.submit({ recipientAllowanceId: '1', amountUnits: '1' }, 'venue')).statusCode).toBe(202);
  expect((await f.service.submit({ recipientAllowanceId: '1', amountUnits: '1' }, 'venue')).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});
test('expired unsigned claims recover and claim_token fences both admission and saving', async () => {
  const f = await fixture();
  const plan: RegistrationPlan = { kind: 'payer', pool: 'public', publicKey, keyHash: P.toHex(P.keyHash(P.base64urlDecode(publicKey))),
    allowanceId: '123', expiry: 1800003600, policy };
  const old = (await f.store.claim('1', plan))!;
  expect(await f.store.claim('1', plan)).toBeNull();
  await f.db.query('UPDATE remittance_jobs SET lease_expires_at=0');
  const fresh = (await f.store.claim('1', plan))!, row = await f.store.get('1');
  expect(fresh).not.toBe(old); expect(await f.store.claim('1', plan)).toBeNull();
  expect(await f.store.reserve('1', old, { units: '1', funderLamports: '1', feeLamports: '1' }, policy.daily)).toBe(false);
  expect(await f.store.save(row, old, await f.chain.sign())).toBe(false);
  expect(await f.store.save(row, fresh, await f.chain.sign())).toBe(true);
  await f.db.query('UPDATE remittance_jobs SET lease_expires_at=0');
  expect(await f.store.claim('1', plan)).toBeNull();
});
test('burst guard admits ten shared-network sends, holds only HMAC keys and expires', () => {
  let now = 0; const guard = new BurstGuard(10, () => now);
  for (let n = 0; n < 10; n++) expect(guard.admit('raw-network-identifier')).toBe(true);
  expect(guard.admit('raw-network-identifier')).toBe(false);
  expect(JSON.stringify(guard)).not.toContain('raw-network-identifier');
  now = 3600000; expect(guard.admit('raw-network-identifier')).toBe(true);
  expect(() => new BurstGuard(9)).toThrow();
});
test('service admits ten new venue sends, then returns unsigned rate limit before another quote', async () => {
  const f = await fixture();
  for (let n = 0; n < 10; n++) expect((await f.service.submit({ recipientAllowanceId: String(n), amountUnits: '1' }, 'venue')).statusCode).toBe(201);
  await expect(f.service.submit({ recipientAllowanceId: '10', amountUnits: '1' }, 'venue')).rejects.toMatchObject({ statusCode: 429, code: 'rate_limited' });
  expect(f.chain.quote).toHaveBeenCalledTimes(10); expect(f.chain.sign).toHaveBeenCalledTimes(10);
  const { rows } = await f.db.query('SELECT plan FROM remittance_jobs'); expect(JSON.stringify(rows)).not.toContain('venue');
});
test('a send-wallet budget is atomic across two operation namespaces', async () => {
  const f = await fixture(), other = new RemittanceStore(f.db, 'other-deployment', () => 1800000000, 'fixture');
  const plan: RegistrationPlan = { kind: 'payer', pool: 'public', publicKey, keyHash: P.toHex(P.keyHash(P.base64urlDecode(publicKey))), allowanceId: '1', expiry: 1800003600, policy };
  const a = (await f.store.claim('1', plan))!, b = (await other.claim('1', plan))!;
  const cost = { units: '1000000', funderLamports: '1', feeLamports: '1' };
  const results = await Promise.all([f.store.reserve('1', a, cost, policy.daily), other.reserve('1', b, cost, policy.daily)]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
test('empty or unsorted earmarks fail before any funding', async () => {
  const f = await fixture();
  const options = { store: f.store, chain: f.chain as unknown as RegistrationChain & { recipient(id: string): Promise<{ publicKey: string }> },
    signer: { allow: async () => 'unused', merchant: async () => 'unused' }, policy: { ...policy, earmarks: [] } };
  expect(() => new RemittanceService(options)).toThrow();
  expect(() => new RemittanceService({ ...options, policy: { ...policy, earmarks: ['ff'.repeat(32), '00'.repeat(32)] } })).toThrow();
  expect(f.chain.sign).not.toHaveBeenCalled();
});
