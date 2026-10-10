import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { p256 } from '@noble/curves/nist.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { SettlementStore } from './store.js';
import { SettlementService } from './service.js';
import { registerSettlementRoutes } from './routes.js';
import { testDatabase } from './test-database.js';
import type { ChainGateway, IdentityRefusal, PreparedAttempt } from './types.js';

const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
const deployment = { programId: P.fromHex(vectors.constants.programIdHex), clusterId: 0,
  mint: P.fromHex(vectors.constants.mintHex) };
const base = P.validateNoteWire(P.fromHex(vectors.notes[0].wireHex), deployment);
const secret = randomBytes(32);
const note = (amount: number, allowanceId = base.note.allowanceId) => {
  const bytes = P.encodeNote(deployment, { ...base.note, allowanceId, amount: BigInt(amount) });
  return P.base64urlEncode(new Uint8Array([...bytes, ...p256.sign(bytes, secret, { lowS: true }), ...p256.getPublicKey(secret)]));
};
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

async function fixture() {
  const db = await testDatabase(); closers.push(() => db.close());
  let time = 1800000000;
  const clock = () => time;
  const store = new SettlementStore(db, clock); await store.migrate();
  const chain = {
    checkIdentity: vi.fn(async (): Promise<IdentityRefusal | null> => null), blockHeight: vi.fn(async () => 0),
    quoteFee: vi.fn(async () => ({ message: 'unsigned', blockhash: 'quote', lastValidBlockHeight: 100,
      feePayer: base58.encode(new Uint8Array(32).fill(7)), lamports: '10' })),
    prepare: vi.fn(async (upload: P.ValidatedNote): Promise<PreparedAttempt> => ({
      signature: base58.encode(new Uint8Array([...upload.noteId, ...upload.noteId])),
      rawTransaction: 'test-only', blockhash: base58.encode(new Uint8Array(32).fill(1)), lastValidBlockHeight: 100,
    })),
    send: vi.fn(async () => {}), observe: vi.fn(async () => null),
    lookup: vi.fn(async () => ({ found: true, decision: { slot: 1, blockTime: 1800000000, error: null as string | null, errorCode: 0 } })),
  } satisfies ChainGateway;
  const seed = randomBytes(32); const sign = vi.fn((fields: P.ConfFields) => P.signConfWire(fields, seed));
  const options = { feeBudget: { feePayer: base58.encode(new Uint8Array(32).fill(7)), dailyLamports: '1000000' }, deployment, store, chain, signConfirmation: sign, now: clock,
    allowanceRateLimit: { limit: 2, windowSeconds: 60 } };
  const service = new SettlementService(options);
  const app = Fastify({ logger: false }); registerSettlementRoutes(app, service); closers.push(() => app.close());
  const post = (wire: string) => app.inject({ method: 'POST', url: '/v1/notes', payload: { note: wire } });
  return { db, store, chain, sign, service, options, post, advance: (seconds: number) => { time += seconds; } };
}

test('allowance submissions are limited atomically across service instances and resume next window', async () => {
  const f = await fixture(); const other = new SettlementService({ ...f.options, store: new SettlementStore(f.db, f.options.now) });
  const outcomes = await Promise.allSettled([f.service.submit({ note: note(1) }), other.submit({ note: note(2) }),
    f.service.submit({ note: note(3) })]);
  expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(2);
  expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { statusCode: 429, code: 'rate_limited' } });
  expect(f.chain.prepare).toHaveBeenCalledTimes(2); expect(f.chain.send).toHaveBeenCalledTimes(2);
  const denied = await f.post(note(4)); expect(denied.statusCode).toBe(429); expect(denied.headers['retry-after']).toBe('60');
  expect(denied.json().message).toMatch(/^[A-Z].+\.$/);
  const unknown = P.toHex(P.validateNoteWire(P.base64urlDecode(note(4)), deployment).noteId);
  expect(await f.store.get(unknown)).toBeNull(); expect(f.sign).toHaveBeenCalledTimes(2);
  f.advance(60); expect((await f.post(note(4))).statusCode).toBe(200);
});

test('allowances have separate counters and rate storage contains only deployment and allowance identifiers', async () => {
  const f = await fixture(); await f.post(note(1)); await f.post(note(2));
  expect((await f.post(note(3))).statusCode).toBe(429);
  expect((await f.post(note(4, base.note.allowanceId + 1n))).statusCode).toBe(200);
  const result = await f.db.query('SELECT * FROM settlement_rate_limits');
  expect(result.rows).toHaveLength(2);
  expect(Object.keys(result.rows[0]).sort()).toEqual(['allowance_key', 'used', 'window_start']);
  expect(JSON.stringify(result.rows)).not.toContain(P.toHex(p256.getPublicKey(secret)));
});

test('a reused-serial cheat reaches the chain below the allowance limit', async () => {
  const f = await fixture(); const first = await f.post(note(1)); expect(first.statusCode).toBe(200);
  f.chain.lookup.mockResolvedValue({ found: true, decision: { slot: 2, blockTime: 1800000000, error: 'SerialUsed', errorCode: 6011 } });
  const cheat = await f.post(note(2));
  expect(base.note.serial).toBe(P.validateNoteWire(P.base64urlDecode(note(2)), deployment).note.serial);
  expect(cheat.statusCode).toBe(200); expect(cheat.json()).toMatchObject({ status: 'failed', error: 'SerialUsed', errorCode: 6011 });
  expect(f.chain.send).toHaveBeenCalledTimes(2);
  expect(cheat.json().signature).not.toBe(first.json().signature);
});

test('invalid signatures and mismatched payer keys cannot consume the allowance limit', async () => {
  const f = await fixture(); const bad = P.base64urlDecode(note(1)); bad[141] ^= 1;
  expect((await f.post(P.base64urlEncode(bad))).statusCode).toBe(422);
  f.chain.checkIdentity.mockResolvedValueOnce('payer_mismatch');
  expect((await f.post(note(1))).statusCode).toBe(422);
  expect((await f.post(note(1))).statusCode).toBe(200); expect((await f.post(note(2))).statusCode).toBe(200);
});

test('repeated uploads are submissions while GET polling does not consume the limit', async () => {
  const f = await fixture(); const first = (await f.post(note(1))).json();
  for (let i = 0; i < 3; i++) expect((await f.service.get(first.noteId)).statusCode).toBe(200);
  expect((await f.post(note(1))).json().replayed).toBe(true); expect((await f.post(note(1))).statusCode).toBe(429);
  expect(f.chain.send).toHaveBeenCalledTimes(1);
});

test('an older window observation cannot reset the current allowance quota', async () => {
  const f = await fixture(); f.advance(60);
  expect((await f.post(note(1))).statusCode).toBe(200); expect((await f.post(note(2))).statusCode).toBe(200);
  f.advance(-60);
  expect((await f.post(note(3))).statusCode).toBe(429); expect(f.chain.send).toHaveBeenCalledTimes(2);
  const result = await f.db.query('SELECT window_start FROM settlement_rate_limits');
  expect(Number(result.rows[0].window_start)).toBe(1800000060);
});
