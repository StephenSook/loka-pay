import { randomBytes } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { p256 } from '@noble/curves/nist.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as P from '@lokapay/protocol';
import { testDatabase } from '../settle/test-database.js';
import { RegistrationStore } from './store.js';
import { RegistrationService } from './service.js';
import { registerRegistrationRoutes } from './routes.js';
import { certificateSigner } from '../certs/signing.js';
import type { RegistrationChain, RegistrationPlan, Quote, Policy, Job, Kind } from './types.js';

const deployment = { programId: new Uint8Array(32).fill(1), mint: new Uint8Array(32).fill(2), clusterId: 0 };
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
const key = () => P.base64urlEncode(p256.getPublicKey(randomBytes(32)));
const policy: Policy = { capUnits: '100', offlineLimitUnits: '50', bondUnits: '5', lifetimeSeconds: 3600, earmarks: [],
  daily: { units: '210', funderLamports: '20', feeLamports: '30' } };
class Chain implements RegistrationChain {
  taken = vi.fn(async (_id: string) => false);
  existingMerchant = vi.fn(async (_publicKey: string): Promise<string | null> => null);
  quote = vi.fn(async (_plan: RegistrationPlan): Promise<Quote> => ({ message: 'unsigned', blockhash: 'test',
    lastValidBlockHeight: 100, cost: { units: _plan.kind === 'payer' ? '105' : '0',
      funderLamports: _plan.kind === 'payer' ? '10' : '0', feeLamports: '10' } }));
  sign = vi.fn(async (_quote: Quote, _plan: RegistrationPlan) => ({ signature: `signature-${this.sign.mock.calls.length}`,
    rawTransaction: 'test-only', blockhash: 'test', lastValidBlockHeight: 100 }));
  send = vi.fn(async () => {});
  outcome: 'ok' | 'collision' | 'failed' | null = 'ok';
  observe = vi.fn(async () => this.outcome);
}
async function fixture(teamKeys: string[] = []) {
  const db = await testDatabase(); closers.push(() => db.close());
  let now = 1800000000;
  const clock = () => now;
  const store = new RegistrationStore(db, 'test-deployment', clock); await store.migrate();
  const chain = new Chain(); const seed = randomBytes(32);
  const signer = certificateSigner(deployment, seed);
  const allow = vi.spyOn(signer, 'allow'); const merchant = vi.spyOn(signer, 'merchant');
  const options = { store, chain, signer, teamKeys, policies: { team: policy, public: policy }, now: clock };
  const service = new RegistrationService(options);
  const app = Fastify({ logger: false }); registerRegistrationRoutes(app, service); closers.push(() => app.close());
  const post = (kind: 'payers' | 'merchants', body: object) => app.inject({ method: 'POST', url: `/v1/${kind}`, payload: body });
  return { db, store, chain, seed, allow, merchant, service, options, post, setNow: (value: number) => { now = value; } };
}

function unsignedJob(kind: Kind, publicKey: string): Job {
  return { id: `claim-${P.toHex(P.keyHash(P.base64urlDecode(publicKey)))}`, plan: {
    kind, publicKey, keyHash: P.toHex(P.keyHash(P.base64urlDecode(publicKey))), name: kind === 'merchant' ? 'First shop' : undefined,
    pool: 'public', policy, expiry: 1800003600,
  }, attempt: null, result: null };
}

test.each(['payer', 'merchant'] as const)('registration lease not expired stays pending for %s', async kind => {
  const f = await fixture(); const publicKey = key();
  await f.store.claim(unsignedJob(kind, publicKey), f.options.now());
  f.setNow(1800000029);
  const response = await f.service.submit(kind, { publicKey, ...(kind === 'merchant' ? { name: 'New name' } : {}) });
  expect(response).toMatchObject({ statusCode: 202, body: { status: 'pending', signature: null } });
  expect(f.chain.quote).not.toHaveBeenCalled(); expect(f.chain.sign).not.toHaveBeenCalled(); expect(f.chain.send).not.toHaveBeenCalled();
});

test.each(['payer', 'merchant'] as const)('expired registration lease takes over once for %s', async kind => {
  const f = await fixture(); const publicKey = key(); const job = unsignedJob(kind, publicKey);
  await f.store.claim(job, f.options.now()); f.setNow(1800000030);
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  const input = { publicKey, ...(kind === 'merchant' ? { name: 'Changed name' } : {}) };
  await Promise.all([f.service.submit(kind, input), other.submit(kind, input), f.service.submit(kind, input)]);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
  const saved = await f.store.get(kind, job.plan.keyHash);
  expect(saved.id).toBe(job.id); expect(saved.plan.expiry).toBe(job.plan.expiry);
  if (kind === 'merchant') expect(saved.plan.name).toBe('First shop');
  expect((await other.submit(kind, input)).statusCode).toBe(200);
});

test('a registration crash after claim recovers on the next request after the lease', async () => {
  const f = await fixture(); const publicKey = key(); const get = f.store.get.bind(f.store);
  vi.spyOn(f.store, 'get').mockRejectedValueOnce(new Error('crash after durable claim'));
  expect((await f.post('payers', { publicKey })).statusCode).toBe(500);
  expect((await get('payer', unsignedJob('payer', publicKey).plan.keyHash)).attempt).toBeNull();
  expect(f.chain.sign).not.toHaveBeenCalled(); f.setNow(1800000030);
  const restarted = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  expect((await restarted.submit('payer', { publicKey })).statusCode).toBe(201);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a registration reservation with a lost reply recovers after the lease without refunding the old budget', async () => {
  const f = await fixture(); const publicKey = key(); const reserve = f.store.reserve.bind(f.store);
  vi.spyOn(f.store, 'reserve').mockImplementationOnce(async (...args) => { await reserve(...args); throw new Error('lost reservation reply'); });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202); f.setNow(1800000030);
  expect((await f.post('payers', { publicKey })).statusCode).toBe(201);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '210', funderLamports: '20', feeLamports: '20' });
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a fenced-out registration worker cannot save or broadcast after takeover', async () => {
  const f = await fixture(); const publicKey = key();
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  f.chain.sign.mockImplementationOnce(async () => { await barrier; return {
    signature: 'expired-worker', rawTransaction: 'test-only', blockhash: 'test', lastValidBlockHeight: 100,
  }; });
  const old = f.service.submit('payer', { publicKey });
  await vi.waitFor(() => expect(f.chain.sign).toHaveBeenCalledTimes(1)); f.setNow(1800000030);
  const replacement = await f.service.submit('payer', { publicKey }); expect(replacement.statusCode).toBe(201);
  release(); expect((await old).statusCode).toBe(200);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  const saved = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  expect(saved.attempt?.signature).not.toBe('expired-worker');
  const history = await f.db.query('SELECT signature FROM registration_attempts WHERE job_id=$1', [saved.id]);
  expect(history.rows).toHaveLength(1); expect(history.rows[0].signature).not.toBe('expired-worker');
});

test('an expired registration worker cannot save before a takeover either', async () => {
  const f = await fixture(); const publicKey = key();
  f.chain.sign.mockImplementationOnce(async () => { f.setNow(1800000030); return {
    signature: 'expired-worker', rawTransaction: 'test-only', blockhash: 'test', lastValidBlockHeight: 100,
  }; });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202); expect(f.chain.send).not.toHaveBeenCalled();
  expect((await f.post('payers', { publicKey })).statusCode).toBe(201); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a stale registration quote cannot consume budget or sign after takeover', async () => {
  const f = await fixture(); const publicKey = key();
  let release!: (quote: Quote) => void;
  f.chain.quote.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const old = f.service.submit('payer', { publicKey });
  await vi.waitFor(() => expect(f.chain.quote).toHaveBeenCalledTimes(1)); f.setNow(1800000030);
  expect((await f.post('payers', { publicKey })).statusCode).toBe(201);
  release({ message: 'unsigned', blockhash: 'test', lastValidBlockHeight: 100,
    cost: { units: '105', funderLamports: '10', feeLamports: '10' } });
  expect((await old).statusCode).toBe(200);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '105', funderLamports: '10', feeLamports: '10' });
});

test('a fenced-out unsigned failure cannot release the new registration claim', async () => {
  const f = await fixture(); const publicKey = key();
  let reject!: (error: Error) => void;
  f.chain.quote.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail; }));
  const old = f.service.submit('payer', { publicKey });
  await vi.waitFor(() => expect(f.chain.quote).toHaveBeenCalledTimes(1)); f.setNow(1800000030);
  const reserve = f.store.reserve.bind(f.store);
  vi.spyOn(f.store, 'reserve').mockImplementationOnce(async (...args) => { await reserve(...args); throw new Error('lost new reservation reply'); });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  reject(new Error('old RPC failed'));
  expect((await old).statusCode).toBe(202);
  const saved = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  expect(saved.attempt).toBeNull(); expect(f.chain.send).not.toHaveBeenCalled();
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  f.setNow(1800000060); expect((await f.post('payers', { publicKey })).statusCode).toBe(201);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('payer certificate matches funded terms; repeats use the first signature and budget once', async () => {
  const f = await fixture(); const publicKey = key();
  const first = await f.post('payers', { publicKey }); expect(first.statusCode).toBe(201);
  const body = first.json();
  const cert = P.verifyAllowWire(P.base64urlDecode(body.allowance), deployment, ed25519.getPublicKey(f.seed));
  expect(cert.cap).toBe(100n); expect(cert.bond).toBe(5n); expect(cert.allowanceId.toString()).toBe(body.allowanceId);
  expect(P.toHex(cert.payerKeyHash)).toBe(P.toHex(P.keyHash(P.base64urlDecode(publicKey))));
  const repeat = await f.post('payers', { publicKey }); expect(repeat.statusCode).toBe(200); expect(repeat.json()).toEqual(body);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '105', funderLamports: '10', feeLamports: '10' });
});

test('merchant name uses first NFC name; repeat requests do not sign or spend again', async () => {
  const f = await fixture(); const publicKey = key();
  const first = await f.post('merchants', { publicKey, name: 'Cafe\u0301' }); expect(first.statusCode).toBe(201);
  const cert = P.verifyMerchWire(P.base64urlDecode(first.json().merchant), deployment, ed25519.getPublicKey(f.seed));
  expect(cert.displayName).toBe('Caf\u00e9');
  const repeat = await f.post('merchants', { publicKey, name: 'Different' });
  expect(repeat.statusCode).toBe(200); expect(repeat.json()).toEqual(first.json()); expect(f.merchant).toHaveBeenCalledTimes(1);
});

test('concurrent service instances share one claim, signature and certificate', async () => {
  const f = await fixture(); const publicKey = key();
  let release!: () => void; const barrier = new Promise<void>(resolve => { release = resolve; });
  f.chain.send.mockImplementation(async () => { await barrier; }); f.chain.outcome = null;
  const first = f.service.submit('payer', { publicKey });
  await vi.waitFor(() => expect(f.chain.send).toHaveBeenCalledTimes(1));
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  expect((await other.submit('payer', { publicKey })).statusCode).toBe(202);
  release(); await first; f.chain.outcome = 'ok';
  expect((await other.submit('payer', { publicKey })).statusCode).toBe(200);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('uncertain sends stay pending across restarts, midnight and expiry without new budgets or sends', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  f.chain.send.mockImplementation(async () => { throw new Error('timeout'); });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  f.setNow(1800200000);
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  expect((await other.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1); expect(f.allow).not.toHaveBeenCalled();
});

test('atomic budgets reject concurrent overflow and public traffic cannot consume team budgets', async () => {
  const teamKey = key(); const f = await fixture([P.toHex(P.keyHash(P.base64urlDecode(teamKey)))]);
  const requests = await Promise.all(Array.from({ length: 6 }, () => f.post('payers', { publicKey: key() })));
  expect(requests.filter(r => r.statusCode === 201)).toHaveLength(2);
  expect(requests.filter(r => r.statusCode === 429)).toHaveLength(4);
  expect(f.chain.sign).toHaveBeenCalledTimes(2);
  expect((await f.post('payers', { publicKey: teamKey })).json().pool).toBe('team');
  expect((await f.post('payers', { publicKey: key(), pool: 'team' })).statusCode).toBe(400);
});

test('merchant rent and transaction fees share the selected pool fee budget atomically', async () => {
  const f = await fixture();
  const replies = await Promise.all(Array.from({ length: 6 }, () => f.post('merchants', { publicKey: key(), name: 'Shop' })));
  expect(replies.filter(r => r.statusCode === 201)).toHaveLength(3);
  expect(replies.filter(r => r.statusCode === 429)).toHaveLength(3);
  expect(f.chain.sign).toHaveBeenCalledTimes(3);
});

test('taken random ids and proven confirmed collisions retry, uncertainty does not', async () => {
  const f = await fixture(); f.chain.taken.mockResolvedValueOnce(true);
  f.chain.observe.mockImplementationOnce(async () => { f.setNow(1800000031); return 'collision'; });
  const result = await f.post('payers', { publicKey: key() }); expect(result.statusCode).toBe(201);
  expect(f.chain.taken).toHaveBeenCalledTimes(3); expect(f.chain.send).toHaveBeenCalledTimes(2);
  const ids = f.chain.taken.mock.calls.map(call => call[0]); expect(new Set(ids).size).toBe(3);
  expect(f.allow).toHaveBeenCalledTimes(1);
});

test('renewal is allowed only after a completed allowance expires and receives a fresh id', async () => {
  const f = await fixture(); const publicKey = key();
  const first = (await f.post('payers', { publicKey })).json();
  f.setNow(1800003600);
  const atExpiry = await f.post('payers', { publicKey }); expect(atExpiry.statusCode).toBe(200); expect(atExpiry.json()).toEqual(first);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  f.setNow(1800003601);
  const next = await f.post('payers', { publicKey }); expect(next.statusCode).toBe(201);
  expect(next.json().allowanceId).not.toBe(first.allowanceId); expect(f.chain.send).toHaveBeenCalledTimes(2);
});

test('preexisting merchant uses verified creation signature without another transaction', async () => {
  const f = await fixture(); f.chain.existingMerchant.mockResolvedValue('original-creation-signature');
  const response = await f.post('merchants', { publicKey: key(), name: 'Shop' });
  expect(response.statusCode).toBe(200); expect(response.json().registerSignature).toBe('original-creation-signature');
  expect(f.chain.sign).not.toHaveBeenCalled(); expect(f.chain.send).not.toHaveBeenCalled();
});

test('malformed bodies and keys are refused before storage, RPC or signing', async () => {
  const f = await fixture(); const claim = vi.spyOn(f.store, 'claim');
  for (const body of [{}, { publicKey: 123 }, { publicKey: key(), capUnits: '999' }, { publicKey: key() + '=' },
    { publicKey: P.base64urlEncode(new Uint8Array(33)) }]) expect((await f.post('payers', body)).statusCode).toBe(400);
  for (const name of ['', 'a'.repeat(65), '\ud800']) expect((await f.post('merchants', { publicKey: key(), name })).statusCode).toBe(400);
  expect((await f.post('merchants', { publicKey: key(), name: 'a'.repeat(4096) })).statusCode).toBe(413);
  expect(claim).not.toHaveBeenCalled(); expect(f.chain.quote).not.toHaveBeenCalled(); expect(f.chain.sign).not.toHaveBeenCalled();
});

test('unsigned RPC failure is retryable; failure saving a signed attempt never broadcasts', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.quote.mockRejectedValueOnce(new Error('RPC down'));
  expect((await f.post('payers', { publicKey })).statusCode).toBe(503); expect(f.chain.sign).not.toHaveBeenCalled();
  vi.spyOn(f.store, 'saveAttempt').mockRejectedValue(new Error('DB down'));
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  expect(f.chain.send).not.toHaveBeenCalled(); expect(f.chain.sign).toHaveBeenCalledTimes(1);
});

test('confirmed non-collision failure stays terminal and never signs a certificate', async () => {
  const f = await fixture(); f.chain.outcome = 'failed'; const publicKey = key();
  const first = await f.post('payers', { publicKey }); expect(first.statusCode).toBe(409);
  expect(first.json().error).toBe('registration_failed');
  expect((await f.post('payers', { publicKey })).json()).toEqual(first.json());
  expect(f.chain.send).toHaveBeenCalledTimes(1); expect(f.allow).not.toHaveBeenCalled();
});

test('an uncertain budget commit cannot be admitted or signed a second time', async () => {
  const f = await fixture(); const reserve = f.store.reserve.bind(f.store); const publicKey = key();
  vi.spyOn(f.store, 'reserve').mockImplementation(async (...args) => { await reserve(...args); throw new Error('lost DB reply'); });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  expect(f.store.reserve).toHaveBeenCalledTimes(1); expect(f.chain.sign).not.toHaveBeenCalled(); expect(f.chain.send).not.toHaveBeenCalled();
});

test('each budget dimension caps independently and arithmetic stays exact above Number precision', async () => {
  const f = await fixture();
  const zero = { units: '0', funderLamports: '0', feeLamports: '0' };
  for (const dimension of ['units', 'funderLamports', 'feeLamports'] as const) {
    const limit = { ...zero, [dimension]: '9007199254740993' };
    expect(await f.store.reserve('public', dimension, { ...zero, [dimension]: '9007199254740992' }, limit)).toBe(true);
    expect(await f.store.reserve('public', dimension, { ...zero, [dimension]: '2' }, limit)).toBe(false);
    expect(await f.store.reserve('public', dimension, { ...zero, [dimension]: '1' }, limit)).toBe(true);
  }
});
