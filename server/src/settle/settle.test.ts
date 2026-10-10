import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { PGlite } from '@electric-sql/pglite';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { SettlementStore } from './store.js';
import { SettlementService } from './service.js';
import { registerSettlementRoutes } from './routes.js';
import { testDatabase } from './test-database.js';
import type { ChainGateway, PreparedAttempt, ChainDecision } from './types.js';

const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
const deployment: P.Deployment = {
  programId: P.fromHex(vectors.constants.programIdHex), clusterId: 0,
  mint: P.fromHex(vectors.constants.mintHex),
};
const note = P.base64urlEncode(P.fromHex(vectors.notes[0].wireHex));
const ack = P.base64urlEncode(P.fromHex(vectors.acks[0].wireHex));
const noteId = P.toHex(P.noteId(P.fromHex(vectors.notes[0].noteHex)));
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

class Chain implements ChainGateway {
  bindPayer = vi.fn(async (_note: P.ValidatedNote) => true);
  blockHeight = vi.fn(async () => 0);
  lookup = vi.fn(async (signature: string) => ({ found: this.decision !== null, decision: await this.observe(signature) }));
  prepare = vi.fn(async (validated: P.ValidatedNote): Promise<PreparedAttempt> => ({
    signature: base58.encode(new Uint8Array([...validated.noteId, ...validated.noteId])),
    rawTransaction: 'test-only', blockhash: base58.encode(new Uint8Array(32).fill(1)), lastValidBlockHeight: 100,
  }));
  send = vi.fn(async (_attempt: PreparedAttempt): Promise<void> => {});
  observe = vi.fn(async (_signature: string): Promise<ChainDecision | null> => this.decision);
  decision: ChainDecision | null = { slot: 12, blockTime: 1800000000, error: null, errorCode: 0 };
}

async function fixture() {
  const db = await testDatabase();
  closers.push(() => db.close());
  const store = new SettlementStore(db);
  await store.migrate();
  const chain = new Chain();
  const seed = randomBytes(32);
  const sign = vi.fn((fields: P.ConfFields) => P.signConfWire(fields, seed));
  const service = new SettlementService({ deployment, store, chain, signConfirmation: sign, now: () => 1800000001 });
  const app = Fastify({ logger: false });
  registerSettlementRoutes(app, service);
  closers.push(() => app.close());
  const post = (body: unknown = { note }) => app.inject({ method: 'POST', url: '/v1/notes', payload: body as object });
  const count = async () => (await db.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM settlement_attempts')).rows[0].count;
  return { db, store, chain, seed, sign, service, app, post, count };
}

test('vector upload produces a verified CONF; repeats return the original result', async () => {
  const f = await fixture();
  const first = await f.post({ note, ack });
  expect(first.statusCode).toBe(200);
  const body = first.json();
  expect(body).toMatchObject({ noteId, status: 'settled', error: null, errorCode: 0, replayed: false });
  const conf = P.verifyConfWire(P.base64urlDecode(body.conf), ed25519.getPublicKey(f.seed));
  expect(P.toHex(conf.noteId)).toBe(noteId);
  expect(conf.status).toBe(1);
  expect(conf.uploadedAt).toBe(1800000001n);
  expect(base58.encode(conf.txSignature)).toBe(body.signature);
  expect((await f.post()).json()).toEqual({ ...body, replayed: true });
  expect(f.chain.prepare).toHaveBeenCalledTimes(1);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(f.sign).toHaveBeenCalledTimes(1);
  expect(await f.count()).toBe(1);
});

test.each(vectors.invalidNotes.map((v: { name: string; wireHex: string; error: string }): [string, string, string] => [v.name, v.wireHex, v.error]) as [string, string, string][])(
  'refuses %s before any store access, signing or RPC', async (_name, wireHex, error) => {
    const f = await fixture();
    const claim = vi.spyOn(f.store, 'claim');
    const get = vi.spyOn(f.store, 'get');
    const response = await f.post({ note: P.base64urlEncode(P.fromHex(wireHex)) });
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toBe(error);
    expect(response.json().message).toMatch(/^[A-Z].+\.$/);
    expect(response.json().message).not.toBe(error);
    expect(claim).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(f.chain.prepare).not.toHaveBeenCalled();
    expect(f.sign).not.toHaveBeenCalled();
    expect(await f.count()).toBe(0);
  },
);

test('bad signature cannot poison the same note id, including after settlement', async () => {
  const f = await fixture();
  const wire = P.base64urlDecode(note);
  wire[141] ^= 1;
  const bad = { note: P.base64urlEncode(wire) };
  expect((await f.post(bad)).statusCode).toBe(422);
  expect((await f.app.inject(`/v1/notes/${noteId}`)).statusCode).toBe(404);
  expect((await f.post()).statusCode).toBe(200);
  expect((await f.post(bad)).statusCode).toBe(422);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a valid signature from an alternate payer cannot claim the real note id', async () => {
  const f = await fixture(); const secret = randomBytes(32);
  const real = P.validateNoteWire(P.base64urlDecode(note), deployment);
  f.chain.bindPayer.mockImplementation(async upload => P.equalBytes(upload.payerPublicKey, real.payerPublicKey));
  const forged = new Uint8Array(238); forged.set(real.noteBytes);
  forged.set(p256.sign(real.noteBytes, secret, { lowS: true }), 141); forged.set(p256.getPublicKey(secret), 205);
  expect((await f.post({ note: P.base64urlEncode(forged) })).json().error).toBe('payer_mismatch');
  expect(await f.count()).toBe(0); expect(f.chain.prepare).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
  expect((await f.post()).statusCode).toBe(200);
});

test('binding RPC failure signs nothing and leaves the note id unclaimed', async () => {
  const f = await fixture(); f.chain.bindPayer.mockRejectedValue(new Error('RPC down'));
  expect((await f.post()).statusCode).toBe(503); expect(await f.count()).toBe(0);
  expect(f.chain.prepare).not.toHaveBeenCalled(); expect(f.sign).not.toHaveBeenCalled();
});

test('bad ACK is unsigned and unsaved; a later valid ACK preserves the original CONF', async () => {
  const f = await fixture();
  const bad = P.base64urlDecode(ack);
  bad[56] ^= 1;
  expect((await f.post({ note, ack: P.base64urlEncode(bad) })).json().error).toBe('bad_ack');
  expect(await f.count()).toBe(0);
  expect(f.sign).not.toHaveBeenCalled();
  const first = (await f.post()).json();
  const again = (await f.post({ note, ack })).json();
  expect(again).toEqual({ ...first, replayed: true });
  expect((await f.store.get(noteId))?.ack).toBe(ack);
});

test('two service instances sharing the database prepare and send only once', async () => {
  const f = await fixture();
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  f.chain.send.mockImplementation(async () => { await barrier; });
  const other = new SettlementService({ deployment, store: new SettlementStore(f.db), chain: f.chain, signConfirmation: f.sign });
  const first = f.service.submit({ note });
  await vi.waitFor(() => expect(f.chain.send).toHaveBeenCalledTimes(1));
  f.chain.decision = null;
  const second = await other.submit({ note });
  expect(second.statusCode).toBe(202);
  expect(f.chain.prepare).toHaveBeenCalledTimes(1);
  release();
  await first;
  f.chain.decision = { slot: 12, blockTime: 1800000000, error: null, errorCode: 0 };
  expect((await other.get(noteId)).statusCode).toBe(200);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('signature is durable before broadcast; uncertain send remains pending across service restart', async () => {
  const f = await fixture();
  f.chain.decision = null;
  f.chain.send.mockImplementation(async attempt => {
    expect((await f.store.get(noteId))?.attempt).toEqual(attempt);
    throw new Error('timeout after broadcast');
  });
  expect((await f.post()).statusCode).toBe(202);
  const other = new SettlementService({ deployment, store: new SettlementStore(f.db), chain: f.chain, signConfirmation: f.sign });
  for (let i = 0; i < 3; i++) {
    expect((await other.submit({ note })).statusCode).toBe(202);
    expect((await other.get(noteId)).statusCode).toBe(202);
  }
  expect(f.chain.prepare).toHaveBeenCalledTimes(1);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
  expect(f.sign).not.toHaveBeenCalled();
  f.chain.decision = { slot: 13, blockTime: 1800000002, error: null, errorCode: 0 };
  expect((await other.get(noteId)).statusCode).toBe(200);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('confirmed cheat produces status 2, its named program error and its own signature', async () => {
  const f = await fixture();
  f.chain.decision = { slot: 13, blockTime: 1800000002, error: 'SerialUsed', errorCode: 6011 };
  const body = (await f.post()).json();
  expect(body).toMatchObject({ status: 'failed', error: 'SerialUsed', errorCode: 6011 });
  expect(body.explorer).toContain(`/tx/${body.signature}?cluster=devnet`);
  expect(P.verifyConfWire(P.base64urlDecode(body.conf), ed25519.getPublicKey(f.seed)).status).toBe(2);
  expect((await f.post()).json()).toEqual({ ...body, replayed: true });
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('a claim without a saved signature is never resumed or automatically released', async () => {
  const f = await fixture();
  await f.store.claim({ noteId, note, ack: null, uploadedAt: 1800000001 });
  expect((await f.post()).json()).toEqual({ noteId, status: 'pending', signature: null, retryAfter: 2 });
  expect(f.chain.prepare).not.toHaveBeenCalled();
});

test('failure saving the signed attempt never broadcasts and never signs a confirmation', async () => {
  const f = await fixture();
  vi.spyOn(f.store, 'saveAttempt').mockRejectedValue(new Error('database unavailable'));
  expect((await f.post()).statusCode).toBe(202);
  expect(f.chain.send).not.toHaveBeenCalled();
  expect(f.sign).not.toHaveBeenCalled();
  expect((await f.post()).statusCode).toBe(202);
  expect(f.chain.prepare).toHaveBeenCalledTimes(1);
});

test('malformed bodies, noncanonical encoding and oversized payloads are rejected', async () => {
  const f = await fixture();
  for (const body of [{}, { note, cheat: true }, { note, ack: null }, { note: 12 }]) {
    expect((await f.post(body)).statusCode).toBe(400);
  }
  expect((await f.post({ note: note + '=' })).json().error).toBe('bad_base64url');
  expect((await f.post({ note: 'A'.repeat(4096) })).statusCode).toBe(413);
  expect(await f.count()).toBe(0);
});

test('a disk journal survives database restart and still never rebroadcasts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loka-settle-test-'));
  const seed = randomBytes(32);
  const chain = new Chain();
  chain.decision = null;
  let database = new PGlite(directory);
  try {
    let store = new SettlementStore(database);
    await store.migrate();
    const options = { deployment, chain, signConfirmation: (fields: P.ConfFields) => P.signConfWire(fields, seed) };
    expect((await new SettlementService({ ...options, store }).submit({ note })).statusCode).toBe(202);
    await database.close();
    database = new PGlite(directory);
    store = new SettlementStore(database);
    const resumed = new SettlementService({ ...options, store });
    expect((await resumed.submit({ note })).statusCode).toBe(202);
    expect(chain.send).toHaveBeenCalledTimes(1);
    chain.decision = { slot: 99, blockTime: 1800000050, error: null, errorCode: 0 };
    expect((await resumed.get(noteId)).statusCode).toBe(200);
    expect(chain.prepare).toHaveBeenCalledTimes(1);
  } finally {
    await database.close();
    // Only this test's generated directory is removed.
    await rm(directory, { recursive: true, force: true });
  }
});

test('claim failure never reaches the transaction signer', async () => {
  const f = await fixture();
  vi.spyOn(f.store, 'claim').mockRejectedValue(new Error('database unavailable'));
  expect((await f.post()).statusCode).toBe(500);
  expect(f.chain.prepare).not.toHaveBeenCalled();
  expect(f.chain.send).not.toHaveBeenCalled();
});

test('unavailable confirmation metadata stays pending without a signed decision', async () => {
  const f = await fixture();
  f.chain.observe.mockRejectedValue(new Error('RPC timeout'));
  expect((await f.post()).statusCode).toBe(202);
  expect((await f.post()).statusCode).toBe(202);
  expect(f.sign).not.toHaveBeenCalled();
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('expired and not found rebuilds exactly once, including concurrent polls', async () => {
  const f = await fixture(); f.chain.decision = null;
  const first = await f.service.submit({ note }); const original = first.body.signature;
  f.chain.blockHeight.mockResolvedValue(101);
  f.chain.prepare.mockResolvedValue({ signature: base58.encode(new Uint8Array(64).fill(8)), rawTransaction: 'replacement',
    blockhash: base58.encode(new Uint8Array(32).fill(8)), lastValidBlockHeight: 200 });
  const other = new SettlementService({ deployment, store: new SettlementStore(f.db), chain: f.chain, signConfirmation: f.sign });
  await Promise.all([f.service.get(noteId), other.get(noteId), f.service.get(noteId)]);
  expect(f.chain.prepare).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
  const saved = await f.store.get(noteId); expect(saved?.attempt?.signature).toBe(original);
  expect(saved?.replacement?.signature).not.toBe(original); expect(saved?.rebuildClaimed).toBe(true);
  f.chain.blockHeight.mockResolvedValue(201);
  expect((await other.get(noteId)).statusCode).toBe(202);
  expect(f.chain.prepare).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
});

test('expired but found uses the original result without rebuilding', async () => {
  const f = await fixture(); f.chain.decision = null;
  const first = await f.service.submit({ note }); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.decision = { slot: 12, blockTime: 1800000000, error: null, errorCode: 0 };
  const result = await f.service.get(noteId); expect(result.statusCode).toBe(200); expect(result.body.signature).toBe(first.body.signature);
  expect(f.chain.prepare).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('not expired, exactly at expiry, or found without final metadata all stay pending', async () => {
  const f = await fixture(); f.chain.decision = null; await f.service.submit({ note });
  for (const height of [99, 100]) {
    f.chain.blockHeight.mockResolvedValue(height); expect((await f.service.get(noteId)).statusCode).toBe(202);
  }
  f.chain.blockHeight.mockResolvedValue(101); f.chain.lookup.mockResolvedValue({ found: true, decision: null });
  expect((await f.service.get(noteId)).statusCode).toBe(202);
  expect(f.chain.prepare).toHaveBeenCalledTimes(1); expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('an original found later overrides a replacement result and keeps the original CONF thereafter', async () => {
  const f = await fixture(); f.chain.decision = null; const first = await f.service.submit({ note });
  const original = first.body.signature!; const replacement = base58.encode(new Uint8Array(64).fill(8));
  f.chain.blockHeight.mockResolvedValue(101);
  f.chain.prepare.mockResolvedValue({ signature: replacement, rawTransaction: 'replacement',
    blockhash: base58.encode(new Uint8Array(32).fill(8)), lastValidBlockHeight: 200 });
  f.chain.lookup.mockImplementation(async signature => signature === replacement
    ? { found: true, decision: { slot: 14, blockTime: 1800000001, error: 'SerialUsed', errorCode: 6011 } }
    : { found: false, decision: null });
  expect((await f.service.get(noteId)).body.signature).toBe(replacement);
  f.chain.lookup.mockImplementation(async signature => ({ found: true, decision: {
    slot: 12, blockTime: 1800000000, error: signature === original ? null : 'SerialUsed', errorCode: signature === original ? 0 : 6011,
  } }));
  const result = await f.service.get(noteId); expect(result.body.signature).toBe(original);
  expect(result.body.status).toBe('settled'); expect((await f.service.get(noteId)).body).toEqual(result.body);
  expect(f.chain.send).toHaveBeenCalledTimes(2);
});

test('the original is looked up again after height lookup before admitting a rebuild', async () => {
  const f = await fixture(); f.chain.decision = null; await f.service.submit({ note }); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.lookup.mockResolvedValueOnce({ found: false, decision: null }).mockResolvedValueOnce({ found: true,
    decision: { slot: 12, blockTime: 1800000000, error: null, errorCode: 0 } });
  expect((await f.service.get(noteId)).statusCode).toBe(200); expect(f.chain.prepare).toHaveBeenCalledTimes(1);
});

test('uncertain rebuild preparation consumes the one rebuild claim across restarts', async () => {
  const f = await fixture(); f.chain.decision = null; await f.service.submit({ note }); f.chain.blockHeight.mockResolvedValue(101);
  f.chain.prepare.mockRejectedValue(new Error('timeout'));
  expect((await f.service.get(noteId)).statusCode).toBe(202);
  const other = new SettlementService({ deployment, store: new SettlementStore(f.db), chain: f.chain, signConfirmation: f.sign });
  expect((await other.get(noteId)).statusCode).toBe(202); expect(f.chain.prepare).toHaveBeenCalledTimes(2);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});
