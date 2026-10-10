import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test, vi } from 'vitest';
import Fastify from 'fastify';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { SettlementStore } from '../settle/store.js';
import { SettlementService } from '../settle/service.js';
import { registerSettlementRoutes } from '../settle/routes.js';
import { testDatabase } from '../settle/test-database.js';
import type { ChainDecision, ChainGateway, IdentityRefusal, PreparedAttempt } from '../settle/types.js';
import { installEvents } from './index.js';
import { computeStats, sandboxUsd } from './stats.js';
import { EventStore } from './store.js';

// The real settlement service writes decisions against a stand-in chain; this module projects them.
// That ties these tests to settle/store.ts's journal, so a change to its columns fails here first.
const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
const deployment: P.Deployment = { programId: P.fromHex(vectors.constants.programIdHex), clusterId: 0, mint: P.fromHex(vectors.constants.mintHex) };
const wire = (i: number) => P.base64urlEncode(P.fromHex(vectors.notes[i].wireHex));
const ack0 = P.base64urlEncode(P.fromHex(vectors.acks[0].wireHex));
const payerKeyHash = P.toHex(P.validateNoteWire(P.fromHex(vectors.notes[0].wireHex), deployment).payerKeyHash);
const feeBudget = { feePayer: base58.encode(new Uint8Array(32).fill(7)), dailyLamports: '1000000' };
const closers: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });

class Chain implements ChainGateway {
  decision: ChainDecision | null = { slot: 12, blockTime: 1800000004, error: null, errorCode: 0 };
  quoteFee = vi.fn(async () => ({ message: 'unsigned', blockhash: 'quote', lastValidBlockHeight: 100, feePayer: feeBudget.feePayer, lamports: '10' }));
  checkIdentity = vi.fn(async (_note: P.ValidatedNote): Promise<IdentityRefusal | null> => null);
  blockHeight = vi.fn(async () => 0);
  lookup = vi.fn(async (signature: string) => ({ found: this.decision !== null, decision: await this.observe(signature) }));
  prepare = vi.fn(async (validated: P.ValidatedNote): Promise<PreparedAttempt> => ({
    signature: base58.encode(new Uint8Array([...validated.noteId, ...validated.noteId])),
    rawTransaction: 'test-only', blockhash: base58.encode(new Uint8Array(32).fill(1)), lastValidBlockHeight: 100,
  }));
  send = vi.fn(async (_attempt: PreparedAttempt): Promise<void> => {});
  observe = vi.fn(async (_signature: string): Promise<ChainDecision | null> => this.decision);
}

async function fixture(options: { canaryKeyHashes?: string[]; listen?: boolean } = {}) {
  const db = await testDatabase();
  closers.push(() => db.close());
  const clock = () => 1800000001;
  const store = new SettlementStore(db, clock);
  await store.migrate();
  const chain = new Chain();
  const seed = randomBytes(32);
  const service = new SettlementService({ feeBudget, deployment, store, chain, signConfirmation: fields => P.signConfWire(fields, seed), now: clock });
  const app = Fastify({ logger: false });
  app.addHook('onRequest', async (request, reply) => {
    if (request.headers.origin === 'https://zerobars.us') reply.header('access-control-allow-origin', 'https://zerobars.us');
  });
  registerSettlementRoutes(app, service);
  const events = await installEvents({ app, database: db, deployment, canaryKeyHashes: options.canaryKeyHashes, intervalMs: 50 });
  closers.push(() => app.close());
  if (options.listen) await app.listen({ host: '127.0.0.1', port: 0 });
  const post = (body: object) => app.inject({ method: 'POST', url: '/v1/notes', payload: body });
  return { db, chain, app, events, post };
}

test('a settled upload becomes one event with the note amount, both clocks and the source; repeats add nothing', async () => {
  const f = await fixture();
  expect((await f.post({ note: wire(0), ack: ack0 })).statusCode).toBe(200);
  const [event, ...rest] = await f.events.feed.tick();
  expect(rest).toEqual([]);
  expect(event).toMatchObject({ noteId: vectors.notes[0].noteIdHex, source: 'phone_ble', status: 'settled', error: null,
    amountUnits: '1000000', slot: 12, blockTime: 1800000004, uploadedAt: 1800000001, receivedAt: Number(vectors.acks[0].fields.receivedAt) });
  expect(event.explorer).toBe(`https://explorer.solana.com/tx/${event.signature}?cluster=devnet`);
  expect(Object.keys(event).sort()).toEqual(['amountUnits', 'blockTime', 'error', 'explorer', 'noteId', 'receivedAt',
    'seq', 'signature', 'slot', 'source', 'status', 'uploadedAt']);
  await f.post({ note: wire(0), ack: ack0 });
  expect(await f.events.feed.tick()).toEqual([]);
});

test('a reused serial that fails on chain counts as a refused double spend, not a payment', async () => {
  const f = await fixture();
  await f.post({ note: wire(0) });
  f.chain.decision = { slot: 13, blockTime: 1800000006, error: 'SerialUsed', errorCode: 6011 };
  await f.post({ note: wire(1) });
  await f.events.feed.tick();
  const stats = (await f.app.inject({ url: '/api/stats' })).json();
  expect(stats.totals).toMatchObject({ paymentsSettled: 1, settledVolumeUnits: '1000000', settledVolumeSandboxUsd: '1.000000',
    doubleSpendsRefused: 1, failedOnChain: 1 });
  expect(stats.bySource.phone_ble.doubleSpendsRefused).toBe(1);
});

test('canary payments are tagged, left out by default and counted with include=all', async () => {
  const f = await fixture({ canaryKeyHashes: [payerKeyHash] });
  await f.post({ note: wire(0) });
  await f.events.feed.tick();
  const normal = (await f.app.inject({ url: '/api/stats' })).json();
  expect(normal.excluded).toEqual(['canary', 'ci', 'load_test']);
  expect(normal.totals.paymentsSettled).toBe(0);
  expect(normal.bySource.canary).toBeUndefined();
  const all = (await f.app.inject({ url: '/api/stats?include=all' })).json();
  expect(all.totals.paymentsSettled).toBe(1);
  expect(all.bySource.canary.paymentsSettled).toBe(1);
  expect(all.bySource.phone_ble.paymentsSettled).toBe(0);
});

test('timings recompute from known timestamps with each pair of clocks (PAYMENT-V1 4.3, task 3.41)', async () => {
  const db = await testDatabase();
  closers.push(() => db.close());
  await new EventStore(db, deployment).migrate();
  const row = (id: string, source: string, uploaded: number, block: number, received: number | null, amount = '1000000') => db.query(
    `INSERT INTO payment_events (note_id, seq, source, status, error, amount_units, signature, explorer, slot, block_time, uploaded_at, received_at)
     VALUES ($1, nextval('payment_events_seq'), $2, 'settled', NULL, $3, 'sig', 'url', 1, $4, $5, $6)`,
    [id.repeat(64), source, amount, block, uploaded, received]);
  await row('a', 'phone_ble', 1000, 1002, 940);
  await row('b', 'phone_ble', 2000, 2006, 1700, '250000');
  await row('c', 'sms_rail', 3000, 3010, null);
  const stats = await computeStats(db, {});
  expect(stats.bySource.phone_ble).toMatchObject({ paymentsSettled: 2, settledVolumeUnits: '1250000',
    settledAfterUploadSeconds: { p50: 4, n: 2 }, heldOfflineSeconds: { median: 180, n: 2 }, receiptToSettlementSeconds: { median: 184, n: 2 } });
  expect(stats.bySource.sms_rail).toMatchObject({ paymentsSettled: 1, settledAfterUploadSeconds: { p50: 10, p95: 10 }, heldOfflineSeconds: { median: null, n: 0 } });
  expect(stats.totals).toMatchObject({ paymentsSettled: 3, settledVolumeUnits: '2250000', settledAfterUploadSeconds: { p50: 6, n: 3 } });
  expect(stats.bySource.relay_upgrade.paymentsSettled).toBe(0);
  const windowed = await computeStats(db, { run: { id: 'X', from: 1500, to: 2500 } });
  expect(windowed.totals.paymentsSettled).toBe(1);
  expect(windowed.run).toEqual({ id: 'X', from: 1500, to: 2500 });
});

test('stats query parameters are checked, and EXP-PAY-001 reports itself unrecorded until 3.6 fills its window', async () => {
  const f = await fixture();
  expect((await f.app.inject({ url: '/api/stats?include=some' })).statusCode).toBe(400);
  const unknown = await f.app.inject({ url: '/api/stats?run=EXP-NOPE' });
  expect([unknown.statusCode, unknown.json().error]).toEqual([404, 'unknown_run']);
  const pending = await f.app.inject({ url: '/api/stats?run=EXP-PAY-001' });
  expect([pending.statusCode, pending.json().error]).toEqual([404, 'run_not_recorded']);
  expect((await f.app.inject({ url: '/api/stats?run=toString' })).json().error).toBe('unknown_run');
  const empty = await f.app.inject({ url: '/api/stats', headers: { origin: 'https://zerobars.us' } });
  expect(empty.headers['access-control-allow-origin']).toBe('https://zerobars.us');
  expect(empty.headers['cache-control']).toBe('no-store');
  expect(empty.json().totals).toMatchObject({ paymentsSettled: 0, settledVolumeSandboxUsd: '0.000000', settledAfterUploadSeconds: { p50: null } });
});

test('sandbox USD keeps every base unit', () => {
  expect(sandboxUsd('0')).toBe('0.000000');
  expect(sandboxUsd('1250000')).toBe('1.250000');
  expect(sandboxUsd('18446744073709551615')).toBe('18446744073709.551615');
});

/** Reads SSE frames from a live server until `until` is satisfied or the time runs out. */
async function readEvents(url: string, headers: Record<string, string>, until: (events: { id: number; data: Record<string, unknown> }[]) => boolean, ms = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);
  const response = await fetch(url, { headers, signal: controller.signal });
  const events: { id: number; data: Record<string, unknown> }[] = [];
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for await (const chunk of response.body!) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true });
      let end;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const id = /^id: (\d+)$/m.exec(block), data = /^data: (.*)$/m.exec(block);
        if (id && data && /^event: payment$/m.test(block)) events.push({ id: Number(id[1]), data: JSON.parse(data[1]) });
      }
      if (until(events)) break;
    }
  } catch { /* aborted at the deadline */ } finally { clearTimeout(timeout); controller.abort(); }
  return { response, events };
}

test('/live streams a settlement within 2 s with CORS for our origin, and resumes after Last-Event-ID', async () => {
  const f = await fixture({ listen: true });
  const base = `http://127.0.0.1:${(f.app.server.address() as AddressInfo).port}`;
  const started = Date.now();
  const watching = readEvents(`${base}/live`, { origin: 'https://zerobars.us' }, events => events.length >= 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  const uploaded = Date.now();
  await f.post({ note: wire(0), ack: ack0 });
  const { response, events } = await watching;
  expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
  expect(response.headers.get('access-control-allow-origin')).toBe('https://zerobars.us');
  expect(events.map(e => e.data.noteId)).toEqual([vectors.notes[0].noteIdHex]);
  expect(Date.now() - uploaded).toBeLessThan(2000);
  expect(Date.now() - started).toBeLessThan(3000);

  await f.post({ note: wire(1) });
  await f.post({ note: wire(2) });
  await f.events.feed.tick();
  const resumed = await readEvents(`${base}/live`, { 'last-event-id': String(events[0].id) }, list => list.length >= 2);
  // Same block time, so projection order (and seq) falls back to note id; resume must send exactly the two newer ones.
  expect(resumed.events.map(e => e.data.noteId).sort()).toEqual([vectors.notes[1].noteIdHex, vectors.notes[2].noteIdHex].sort());
  expect(resumed.events.every(e => e.id > events[0].id)).toBe(true);
  expect(resumed.response.headers.get('access-control-allow-origin')).toBeNull();
  const fresh = await readEvents(`${base}/live`, {}, list => list.length >= 3);
  expect(fresh.events.map(e => e.id)).toEqual([...fresh.events.map(e => e.id)].sort((a, b) => a - b));
  expect(fresh.events).toHaveLength(3);
});

test('/live refuses new viewers past the cap with 503 instead of holding sockets open', async () => {
  const db = await testDatabase();
  closers.push(() => db.close());
  await new SettlementStore(db).migrate();
  const app = Fastify({ logger: false });
  const events = await installEvents({ app, database: db, deployment, maxClients: 1, intervalMs: 1000 });
  closers.push(() => app.close());
  events.feed.subscribe(() => {});
  const busy = await app.inject({ url: '/live' });
  expect([busy.statusCode, busy.json().error, busy.headers['retry-after']]).toEqual([503, 'busy', '30']);
});
