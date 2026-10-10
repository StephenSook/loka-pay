import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import * as P from '@lokapay/protocol';
import { softwareNote } from './run.js';
import { summarizeRows } from './measurement.js';

test('load test covers every serial exactly once with canonical signed notes and is excluded', () => {
  const v = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
  const deployment = { programId: P.fromHex(v.constants.programIdHex), mint: P.fromHex(v.constants.mintHex), clusterId: 0 };
  const field = v.notes[0].fields, secret = new Uint8Array(32).fill(1), ids = new Set<string>();
  for (let serial = 0; serial < 256; serial++) {
    const note = softwareNote(deployment, { allowanceId: field.allowanceId, payeeKeyHash: field.payeeKeyHashHex, amountUnits: '1', expiry: field.expiry }, secret, serial);
    expect(note.note.serial).toBe(serial); ids.add(P.toHex(note.noteId));
  }
  expect(ids.size).toBe(256);
  expect(summarizeRows([...ids].map(signature => ({ signature, slot: 1, feeLamports: 1, computeUnits: 1, error: null, source: 'load_test' })))).toMatchObject({ payments: 0, totalFeeLamports: '0' });
});
