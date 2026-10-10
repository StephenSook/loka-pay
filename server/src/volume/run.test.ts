import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Connection, Keypair, Transaction, VersionedTransaction } from '@solana/web3.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { measureLimits, sendMeasuredRedeems, softwareNote, type MeasuredAttempt } from './run.js';
import type { RedeemRow } from './measurement.js';

test('software signing uses protocol vector bytes and low-S for the requested serial', () => {
  const v = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
  const vector = v.notes[0], secret = new Uint8Array(32); secret[31] = 1;
  const note = softwareNote({ programId: P.fromHex(v.constants.programIdHex), mint: P.fromHex(v.constants.mintHex), clusterId: 0 },
    { allowanceId: vector.fields.allowanceId, payeeKeyHash: vector.fields.payeeKeyHashHex, amountUnits: vector.fields.amount, expiry: vector.fields.expiry }, secret, vector.fields.serial);
  expect(P.toHex(note.noteBytes)).toBe(vector.noteHex); expect(P.isLowS(note.signature)).toBe(true);
});

test('simulation replaces blockhash without signing; twenty sends use measured limits and chain metadata', async () => {
  const v = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
  const deployment = { programId: P.fromHex(v.constants.programIdHex), mint: P.fromHex(v.constants.mintHex), clusterId: 0 };
  const field = v.notes[0].fields, secret = new Uint8Array(32).fill(1), payer = Keypair.generate();
  const note = (serial: number) => softwareNote(deployment, { allowanceId: field.allowanceId, payeeKeyHash: field.payeeKeyHashHex, amountUnits: '1', expiry: field.expiry }, secret, serial);
  const rows: RedeemRow[] = [], attempts: MeasuredAttempt[] = [], saved: string[] = [];
  const rpc = { getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
    simulateTransaction: vi.fn(async (_tx: VersionedTransaction, _config: unknown) => ({ value: { err: null, unitsConsumed: 10000, loadedAccountsDataSize: 32768 } })),
    sendRawTransaction: vi.fn(async (bytes: Buffer, options: unknown) => {
      const tx = Transaction.from(bytes), signature = base58.encode(tx.signature!);
      expect(saved).toContain(signature); expect(options).toEqual({ skipPreflight: false, maxRetries: 0 });
      expect(tx.instructions[0].data.readUInt32LE(1)).toBe(11000); expect(tx.instructions[1].data.readUInt32LE(1)).toBe(65536);
      return signature;
    }),
    getTransaction: vi.fn(async () => ({ slot: 1, meta: { fee: 10000, computeUnitsConsumed: 9999, err: null } })) };
  const measured = await measureLimits(rpc as unknown as Connection, note(0), payer);
  expect(rpc.simulateTransaction.mock.calls[0][0].signatures[0].every((byte: number) => byte === 0)).toBe(true);
  expect(rpc.simulateTransaction.mock.calls[0][1]).toEqual({ replaceRecentBlockhash: true, sigVerify: false, commitment: 'confirmed' });
  await sendMeasuredRedeems({ connection: rpc as unknown as Connection, feePayer: payer, note, source: 'measurement', count: 20, start: 0,
    limits: measured.limits, rows, attempts, save: () => { saved.push(...attempts.map(row => row.signature)); } });
  expect(rows).toHaveLength(20); expect(new Set(rows.map(row => row.signature)).size).toBe(20);
  expect(rows.every(row => row.computeUnits === 9999 && row.feeLamports === 10000)).toBe(true);
  rpc.sendRawTransaction.mockRejectedValue(new Error('uncertain send'));
  await expect(sendMeasuredRedeems({ connection: rpc as unknown as Connection, feePayer: payer, note, source: 'measurement', count: 2, start: 20,
    limits: measured.limits, rows, attempts, save: () => { saved.push(...attempts.map(row => row.signature)); } })).rejects.toThrow('uncertain send');
  expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(21); expect(attempts.at(-1)!.status).toBe('prepared');
});
