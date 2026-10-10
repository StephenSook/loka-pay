import { afterEach, expect, test } from 'vitest';
import { base58 } from '@scure/base';
import { SettlementStore } from './store.js';
import { testDatabase } from './test-database.js';
import { validateFeeBudget } from './fee-budget.js';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { while (closers.length) await closers.pop()!(); });
const payer = base58.encode(new Uint8Array(32).fill(7));

test('fee admission is atomic across instances, exact above Number precision, and isolated per payer and UTC day', async () => {
  const db = await testDatabase(); closers.push(() => db.close());
  let now = 1800000000;
  const a = new SettlementStore(db, () => now); await a.migrate();
  const b = new SettlementStore(db, () => now);
  const policy = { feePayer: payer, dailyLamports: '9007199254740993' };
  const rows = Array.from({ length: 3 }, (_, i) => ({ noteId: i.toString(16).padStart(64, '0'), note: 'test', ack: null, uploadedAt: now }));
  const tokens = await Promise.all(rows.map(row => a.claim(row)));
  const results = await Promise.all(rows.map((row, i) => (i % 2 ? b : a).reserveFee(row.noteId, policy, '4503599627370496', { token: tokens[i]! })));
  expect(results.filter(Boolean)).toHaveLength(2);
  expect(await a.reserveFee(rows[0].noteId, policy, '1', { token: tokens[0]! })).toBe(true);
  expect(await a.reserveFee(rows[0].noteId, policy, '1', { token: tokens[0]! })).toBe(false);
  const other = { ...policy, feePayer: base58.encode(new Uint8Array(32).fill(8)) };
  expect(await b.reserveFee(rows[0].noteId, other, '10', { token: tokens[0]! })).toBe(true);
  now += 86400; const token = await a.claim(rows[0]);
  expect(await b.reserveFee(rows[0].noteId, policy, '10', { token: token! })).toBe(true);
});

test('an expired or replaced claim token cannot consume the fee budget', async () => {
  const db = await testDatabase(); closers.push(() => db.close());
  let now = 100; const store = new SettlementStore(db, () => now); await store.migrate();
  const row = { noteId: 'a'.repeat(64), note: 'test', ack: null, uploadedAt: now };
  const old = (await store.claim(row))!; now += 30;
  const next = (await store.claim(row))!;
  const policy = { feePayer: payer, dailyLamports: '10' };
  expect(await store.reserveFee(row.noteId, policy, '10', { token: old })).toBe(false);
  expect(await store.reserveFee(row.noteId, policy, '10', { token: next })).toBe(true);
});

test.each(['-1', '1.1', '01', '1e3', '18446744073709551616'])('invalid fee policy %s fails startup', dailyLamports => {
  expect(() => validateFeeBudget({ feePayer: payer, dailyLamports })).toThrow();
});

test('a conflicting fee policy for the same payer and UTC day fails closed', async () => {
  const db = await testDatabase(); closers.push(() => db.close());
  const store = new SettlementStore(db, () => 100); await store.migrate();
  const row = { noteId: 'b'.repeat(64), note: 'test', ack: null, uploadedAt: 100 };
  const token = (await store.claim(row))!;
  expect(await store.reserveFee(row.noteId, { feePayer: payer, dailyLamports: '10' }, '1', { token })).toBe(true);
  expect(await store.reserveFee(row.noteId, { feePayer: payer, dailyLamports: '20' }, '1', { token })).toBe(false);
});
