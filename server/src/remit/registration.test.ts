import type { PreparedAttempt } from '../settle/types.js';
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
  blockHeight = vi.fn(async () => 0);
  lookup = vi.fn(async (attempt: PreparedAttempt, _plan: RegistrationPlan) => {
    // A later transaction's outcome cannot change a previously confirmed signature.
    for (let i = this.observe.mock.calls.length - 1; i >= 0; i--) {
      if (this.observe.mock.calls[i][0].signature !== attempt.signature || this.observe.mock.results[i].type !== 'return') continue;
      const outcome = await this.observe.mock.results[i].value;
      if (outcome !== null) return { found: true, outcome };
    }
    return { found: this.outcome !== null, outcome: this.outcome };
  });
  taken = vi.fn(async (_id: string) => false);
  existingMerchant = vi.fn(async (_publicKey: string): Promise<string | null> => null);
  quote = vi.fn(async (_plan: RegistrationPlan): Promise<Quote> => ({ message: 'unsigned', blockhash: 'test',
    lastValidBlockHeight: 100, cost: { units: _plan.kind === 'payer' ? '105' : '0',
      funderLamports: _plan.kind === 'payer' ? '10' : '0', feeLamports: '10' } }));
  sign = vi.fn(async (_quote: Quote, _plan: RegistrationPlan) => ({ signature: `signature-${this.sign.mock.calls.length}`,
    rawTransaction: 'test-only', blockhash: 'test', lastValidBlockHeight: 100 }));
  send = vi.fn(async (_attempt: PreparedAttempt) => {});
  outcome: 'ok' | 'collision' | 'failed' | null = 'ok';
  observe = vi.fn(async (_attempt: PreparedAttempt, _plan: RegistrationPlan) => this.outcome);
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

test('uncertain sends recover with identical bytes across restarts and without new budgets', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  f.chain.send.mockImplementation(async () => { throw new Error('timeout'); });
  expect((await f.post('payers', { publicKey })).statusCode).toBe(202);
  f.setNow(1800200000);
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  expect((await other.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(2); expect(f.allow).not.toHaveBeenCalled();
  expect(f.chain.send.mock.calls[1]).toEqual(f.chain.send.mock.calls[0]);
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

test('team renewal is allowed only after a completed allowance expires and receives a fresh id', async () => {
  const publicKey = key(); const f = await fixture([P.toHex(P.keyHash(P.base64urlDecode(publicKey)))]);
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

test('confirmed non-collision failure requires an explicit retry and never signs a certificate', async () => {
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

test('saved registration resends are leased, bounded and use the saved signature', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  f.chain.send.mockRejectedValueOnce(new Error('lost send'));
  const first = await f.service.submit('payer', { publicKey });
  f.setNow(1800000029); await f.service.submit('payer', { publicKey });
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  f.setNow(1800000030);
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  await Promise.all([f.service.submit('payer', { publicKey }), other.submit('payer', { publicKey })]);
  expect(f.chain.send).toHaveBeenCalledTimes(2);
  f.setNow(1800000060); await other.submit('payer', { publicKey });
  f.setNow(1800000090); await other.submit('payer', { publicKey });
  expect(f.chain.send).toHaveBeenCalledTimes(3);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
  expect(f.chain.send.mock.calls.every(([a]) => a.signature === first.body.signature)).toBe(true);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '105', funderLamports: '10', feeLamports: '10' });
});

test('a crash after saving registration but before broadcast resumes saved bytes', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  vi.spyOn(f.store, 'broadcast').mockRejectedValueOnce(new Error('crash'));
  const first = await f.service.submit('payer', { publicKey });
  expect(f.chain.send).not.toHaveBeenCalled();
  f.setNow(1800000030);
  await f.service.submit('payer', { publicKey });
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(f.chain.send.mock.calls[0][0].signature).toBe(first.body.signature);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
});

test('expired absent registration replaces once with the same plan and id after history search', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  await f.service.submit('payer', { publicKey });
  const original = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  f.setNow(1800000030); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.quote.mockImplementation(async plan => ({ message: 'fresh', blockhash: 'fresh', lastValidBlockHeight: 200,
    cost: { units: (BigInt(plan.policy.capUnits) + BigInt(plan.policy.bondUnits)).toString(), funderLamports: '10', feeLamports: '10' } }));
  f.chain.sign.mockImplementation(async () => ({ signature: 'replacement', rawTransaction: 'new-wire', blockhash: 'fresh', lastValidBlockHeight: 200 }));
  const other = new RegistrationService({ ...f.options, store: new RegistrationStore(f.db, 'test-deployment', f.options.now) });
  await Promise.all([f.service.submit('payer', { publicKey }), other.submit('payer', { publicKey })]);
  const saved = await f.store.get('payer', original.plan.keyHash);
  expect(saved.plan).toEqual(original.plan); expect(saved.attempt!.signature).toBe('replacement');
  expect(f.chain.sign).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
  expect(await f.store.history(saved)).toHaveLength(2);
  f.setNow(1800000060); f.chain.blockHeight.mockResolvedValue(201);
  expect((await other.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(2);
});

test('expired registration found in history never signs a replacement', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  await f.service.submit('payer', { publicKey }); f.setNow(1800000030);
  f.chain.blockHeight.mockResolvedValue(101);
  f.chain.lookup.mockResolvedValue({ found: true, outcome: 'ok' });
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(200);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('registration recovery preparation failure leaves the fenced replacement available', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  await f.service.submit('payer', { publicKey });
  f.setNow(1800000030); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.quote.mockRejectedValueOnce(new Error('quote unavailable'));
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(202);
  f.setNow(1800000060);
  f.chain.quote.mockResolvedValue({ message: 'fresh', blockhash: 'fresh', lastValidBlockHeight: 200,
    cost: { units: '105', funderLamports: '10', feeLamports: '10' } });
  f.chain.sign.mockResolvedValue({ signature: 'fresh', rawTransaction: 'fresh', blockhash: 'fresh', lastValidBlockHeight: 200 });
  expect((await f.service.submit('payer', { publicKey })).body.signature).toBe('fresh');
  expect(f.chain.sign).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
});

test('a found registration signature without final metadata blocks recovery', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  await f.service.submit('payer', { publicKey });
  f.setNow(1800000030); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.lookup.mockResolvedValue({ found: true, outcome: null });
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('an expired registration recovery lease cannot reserve or save its prepared replacement', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  await f.service.submit('payer', { publicKey });
  f.setNow(1800000030); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.quote.mockImplementationOnce(async () => {
    f.setNow(1800000060);
    return { message: 'fresh', blockhash: 'fresh', lastValidBlockHeight: 200,
      cost: { units: '105', funderLamports: '10', feeLamports: '10' } };
  });
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '105', funderLamports: '10', feeLamports: '10' });
});

test('confirmed failure has one explicit repost and concurrent retries admit only one new attempt', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  const failed = await f.service.submit('payer', { publicKey });
  expect(failed).toMatchObject({ statusCode: 409, body: { retryable: true, reason: 'chain_failure' } });
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(409);
  f.chain.outcome = 'ok';
  const input = { publicKey, retryOf: failed.body.retryOf };
  const results = await Promise.all([f.service.submit('payer', input), f.service.submit('payer', input)]);
  expect(results.some(r => r.statusCode === 201)).toBe(true);
  expect(f.chain.sign).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
  const saved = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  expect(await f.store.history(saved)).toHaveLength(2);
});

test('a second confirmed failure reports the retry bound and signs no third transaction', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  const first = await f.service.submit('payer', { publicKey });
  const second = await f.service.submit('payer', { publicKey, retryOf: first.body.retryOf });
  expect(second).toMatchObject({ statusCode: 409, body: { retryable: false } });
  expect((await f.service.submit('payer', { publicKey, retryOf: second.body.retryOf })).statusCode).toBe(409);
  expect(f.chain.sign).toHaveBeenCalledTimes(2); expect(f.allow).not.toHaveBeenCalled();
});

test.each(['payer', 'merchant'] as const)('a crashed unsigned explicit retry resumes once after its lease for %s', async kind => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  const input = { publicKey, ...(kind === 'merchant' ? { name: 'First shop' } : {}) };
  const failed = await f.service.submit(kind, input);
  const job = await f.store.get(kind, unsignedJob(kind, publicKey).plan.keyHash);
  expect(await f.store.claimFailedRetry(job, failed.body.retryOf as string)).not.toBeNull();
  const retry = { ...input, retryOf: failed.body.retryOf };
  f.setNow(1800000029);
  expect((await f.service.submit(kind, retry)).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
  f.setNow(1800000030);
  expect((await f.service.submit(kind, { ...input, retryOf: 'another-signature' })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
  f.chain.outcome = 'ok';
  const results = await Promise.all([f.service.submit(kind, retry), f.service.submit(kind, retry)]);
  expect(results.some(result => result.statusCode === 201)).toBe(true);
  const saved = await f.store.get(kind, job.plan.keyHash);
  expect(saved.id).toBe(job.id); expect(saved.plan.expiry).toBe(job.plan.expiry);
  expect(saved.explicitRetries).toBe(1);
  expect(f.chain.sign).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
  expect((await f.service.submit(kind, retry)).statusCode).toBe(200);
  expect(f.chain.sign).toHaveBeenCalledTimes(2);
});

test('an unsigned explicit retry takeover fences the old token before reservation and save', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  const failed = await f.service.submit('payer', { publicKey });
  const job = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  const oldToken = (await f.store.claimFailedRetry(job, failed.body.retryOf as string))!;
  const unsigned = await f.store.get('payer', job.plan.keyHash);
  f.setNow(1800000030); f.chain.outcome = 'ok';
  let release!: (quote: Quote) => void;
  f.chain.quote.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const winner = f.service.submit('payer', { publicKey, retryOf: failed.body.retryOf });
  await vi.waitFor(() => expect(f.chain.quote).toHaveBeenCalledTimes(2));
  const cost = { units: '105', funderLamports: '10', feeLamports: '10' };
  expect(await f.store.reserve('public', '2027-01-15', cost, policy.daily, { id: job.id, token: oldToken })).toBe(false);
  expect(await f.store.saveAttempt(unsigned, unsigned.plan, { signature: 'stale-retry', rawTransaction: 'stale',
    blockhash: 'test', lastValidBlockHeight: 100 }, oldToken)).toBe(false);
  expect(await f.store.cancelUnsignedRetry(job.id, oldToken)).toBe(false);
  release({ message: 'unsigned', blockhash: 'test', lastValidBlockHeight: 100, cost });
  expect((await winner).statusCode).toBe(201);
  expect(f.chain.send).toHaveBeenCalledTimes(2);
  expect(f.chain.send.mock.calls.every(([attempt]) => attempt.signature !== 'stale-retry')).toBe(true);
  expect((await f.store.get('payer', job.plan.keyHash)).explicitRetries).toBe(1);
});

test('confirmed collision with denied budget returns a repost signal and can recover after reset', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'collision';
  f.options.policies.public = { ...policy, daily: { ...policy.daily, units: '105' } };
  const service = new RegistrationService(f.options);
  const failed = await service.submit('payer', { publicKey });
  expect(failed).toMatchObject({ statusCode: 409, body: { retryable: true, reason: 'collision_budget_exhausted' } });
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.allow).not.toHaveBeenCalled();
  f.setNow(1800086400); f.chain.outcome = 'ok';
  expect((await service.submit('payer', { publicKey, retryOf: failed.body.retryOf })).statusCode).toBe(201);
  expect(f.chain.sign).toHaveBeenCalledTimes(2);
  const saved = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  expect(saved.plan.expiry).toBeGreaterThan(f.options.now());
});

test('an uncertain registration send cannot use retryOf to create another signature', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = null;
  const pending = await f.service.submit('payer', { publicKey });
  expect((await f.service.submit('payer', { publicKey, retryOf: pending.body.signature })).statusCode).toBe(202);
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
});

test('public onboarding refuses a second funded claim after expiry and never spends team budget', async () => {
  const f = await fixture(); const publicKey = key();
  const first = await f.post('payers', { publicKey }); expect(first.statusCode).toBe(201);
  expect((await f.post('payers', { publicKey })).statusCode).toBe(200);
  f.setNow(1800003601);
  const second = await f.post('payers', { publicKey });
  expect(second.statusCode).toBe(409); expect(second.json().error).toBe('onboarding_already_claimed');
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(await f.store.spent('team', '2027-01-15')).toBeNull();
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '105', funderLamports: '10', feeLamports: '10' });
});

test('the public pool cap holds under simultaneous onboarding and leaves team funds untouched', async () => {
  const f = await fixture();
  const results = await Promise.all(Array.from({ length: 5 }, () => f.post('payers', { publicKey: key() })));
  expect(results.filter(r => r.statusCode === 201)).toHaveLength(2);
  expect(results.filter(r => r.statusCode === 429)).toHaveLength(3);
  expect(await f.store.spent('public', '2027-01-15')).toEqual({ units: '210', funderLamports: '20', feeLamports: '20' });
  expect(await f.store.spent('team', '2027-01-15')).toBeNull();
  expect(f.chain.sign.mock.calls.every(([, plan]) => plan.pool === 'public')).toBe(true);
});

test('unsigned retry budget denial restores the repost signal without consuming its retry slot', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  f.options.policies.public = { ...policy, daily: { ...policy.daily, units: '105' } };
  const service = new RegistrationService(f.options);
  const failed = await service.submit('payer', { publicKey });
  const denied = await service.submit('payer', { publicKey, retryOf: failed.body.retryOf });
  expect(denied).toMatchObject({ statusCode: 409, body: { retryable: true, retryOf: failed.body.retryOf } });
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
  f.setNow(1800086400); f.chain.outcome = 'ok';
  expect((await service.submit('payer', { publicKey, retryOf: failed.body.retryOf })).statusCode).toBe(201);
});

test('a saved legacy failure gains a repost signal only after confirming its chain failure', async () => {
  const f = await fixture(); const publicKey = key(); f.chain.outcome = 'failed';
  const failed = await f.service.submit('payer', { publicKey });
  await f.db.query('UPDATE registration_jobs SET result=$1::jsonb',
    [JSON.stringify({ statusCode: 409, body: { error: 'registration_failed', signature: failed.body.signature } })]);
  f.chain.outcome = null;
  expect((await f.service.submit('payer', { publicKey })).body.retryable).toBeUndefined();
  f.chain.outcome = 'failed';
  const upgraded = await f.service.submit('payer', { publicKey });
  expect(upgraded).toMatchObject({ statusCode: 409, body: { retryable: true, retryOf: failed.body.signature } });
  expect(f.chain.sign).toHaveBeenCalledTimes(1);
  f.chain.outcome = 'ok';
  expect((await f.service.submit('payer', { publicKey, retryOf: upgraded.body.retryOf })).statusCode).toBe(201);
});

async function savedReplacement(f: Awaited<ReturnType<typeof fixture>>, publicKey: string) {
  f.chain.outcome = null;
  const first = await f.service.submit('payer', { publicKey });
  const original = await f.store.get('payer', unsignedJob('payer', publicKey).plan.keyHash);
  f.setNow(1800000030); const token = (await f.store.claimRecovery(original))!;
  const replacement = { ...original.attempt!, signature: 'replacement-collision', blockhash: 'fresh', lastValidBlockHeight: 200 };
  expect(await f.store.saveRecovery(original, replacement, token)).toBe(true);
  return { first, original, replacement };
}

test.each(['collision', 'failed'] as const)('original registration success wins over replacement %s without another attempt', async terminal => {
  const f = await fixture(); const publicKey = key(); const { original } = await savedReplacement(f, publicKey);
  f.chain.outcome = terminal;
  f.chain.lookup.mockImplementation(async attempt => ({ found: true, outcome: attempt.signature === original.attempt!.signature ? 'ok' : terminal }));
  const result = await f.service.submit('payer', { publicKey });
  expect(result).toMatchObject({ statusCode: 200, body: { openSignature: original.attempt!.signature, allowanceId: original.plan.allowanceId } });
  const fields = P.verifyAllowWire(P.base64urlDecode(result.body.allowance as string), deployment, ed25519.getPublicKey(f.seed));
  expect(fields.allowanceId.toString()).toBe(original.plan.allowanceId);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a found original without final metadata keeps a replacement collision pending', async () => {
  const f = await fixture(); const publicKey = key(); await savedReplacement(f, publicKey);
  f.chain.outcome = 'collision'; f.chain.lookup.mockResolvedValue({ found: true, outcome: null });
  expect((await f.service.submit('payer', { publicKey })).statusCode).toBe(202);
  expect(f.allow).not.toHaveBeenCalled(); expect(f.chain.sign).toHaveBeenCalledTimes(1);
});

test.each([false, true])('late original success overrides a cached replacement failure before repost (retryOf=%s)', async repost => {
  const f = await fixture(); const publicKey = key(); const { original } = await savedReplacement(f, publicKey);
  f.chain.outcome = 'failed'; f.chain.lookup.mockResolvedValue({ found: false, outcome: null });
  const failed = await f.service.submit('payer', { publicKey }); expect(failed.statusCode).toBe(409);
  f.chain.lookup.mockImplementation(async attempt => ({ found: true, outcome: attempt.signature === original.attempt!.signature ? 'ok' : 'failed' }));
  const input = { publicKey, ...(repost ? { retryOf: failed.body.retryOf } : {}) };
  expect(await f.service.submit('payer', input)).toMatchObject({ statusCode: 200, body: { openSignature: original.attempt!.signature } });
  expect((await f.store.get('payer', original.plan.keyHash)).explicitRetries).toBe(0);
  expect(f.chain.sign).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});
