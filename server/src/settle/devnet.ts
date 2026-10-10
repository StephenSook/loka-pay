// User-run acceptance test only. Does not deploy, provision accounts, generate keys or fund wallets.
// Inputs must be two valid notes for an existing allowance, signed by its registered payer.
// Use a fresh serial for the first note, then the same serial with different signed bytes for the cheat.
// Confirmation signing here uses the public vector seed, never the VPS production signing key.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import * as P from '@lokapay/protocol';
import { SettlementStore } from './store.js';
import { SettlementService } from './service.js';
import { SolanaGateway } from './transaction.js';
import { validateUpload } from './validation.js';
import type { Outcome } from './types.js';

const { values } = parseArgs({ options: {
  'run-devnet': { type: 'boolean' }, 'note-request': { type: 'string' }, 'cheat-request': { type: 'string' },
  'fee-payer': { type: 'string' }, 'daily-fee-budget': { type: 'string' }, journal: { type: 'string' },
} });
assert(values['run-devnet'], 'Explicit --run-devnet is required. This command spends devnet transaction fees.');
for (const flag of ['note-request', 'cheat-request', 'fee-payer', 'journal', 'daily-fee-budget'] as const) assert(values[flag], `Missing --${flag}`);
assert(isAbsolute(values.journal!), '--journal must be an absolute directory path for persistent attempt storage');
const deployment = {
  programId: new PublicKey('HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG').toBytes(), clusterId: 0,
  mint: new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU').toBytes(),
};
const request = JSON.parse(readFileSync(values['note-request']!, 'utf8'));
const cheatRequest = JSON.parse(readFileSync(values['cheat-request']!, 'utf8'));
const first = validateUpload(request, deployment);
const cheat = validateUpload(cheatRequest, deployment);
assert(first.noteId !== cheat.noteId, 'Cheat must change signed note bytes, not resend the same note id');
assert(first.validated.note.allowanceId === cheat.validated.note.allowanceId, 'Cheat must use the same allowance');
assert(first.validated.note.serial === cheat.validated.note.serial, 'Cheat must reuse the serial');
assert(P.equalBytes(first.validated.payerPublicKey, cheat.validated.payerPublicKey), 'Cheat must have the same payer');
const secret = JSON.parse(readFileSync(values['fee-payer']!, 'utf8'));
assert(Array.isArray(secret) && secret.length === 64 && secret.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Invalid existing fee-payer keypair');
const feePayer = Keypair.fromSecretKey(Uint8Array.from(secret));
const seed = new Uint8Array(createHash('sha256').update('LOKA-PAY-V1 test key server-ed25519').digest());
const database = new PGlite(values.journal!);
try {
  const store = new SettlementStore(database);
  await store.migrate();
  const makeService = (deliberateCheat = false) => new SettlementService({ deployment, store, feeBudget: { feePayer: feePayer.publicKey.toBase58(), dailyLamports: values['daily-fee-budget']! },
    chain: new SolanaGateway(new Connection('https://api.devnet.solana.com', 'confirmed'), feePayer, { deliberateCheat }),
    signConfirmation: fields => P.signConfWire(fields, seed),
  });
  const service = makeService();
  const wait = async (outcome: Outcome, selected = service) => {
    for (let poll = 0; poll < 30 && outcome.statusCode === 202; poll++) {
      console.log(JSON.stringify(outcome.body));
      await new Promise(resolve => setTimeout(resolve, 2000));
      outcome = await selected.get(outcome.body.noteId);
    }
    if (outcome.statusCode !== 200) throw new Error('Still pending. Keep this journal and investigate; at most one expired, missing attempt can be rebuilt.');
    P.verifyConfWire(P.base64urlDecode(outcome.body.conf), ed25519.getPublicKey(seed));
    return outcome.body;
  };
  const settled = await wait(await service.submit(request));
  assert.equal(settled.status, 'settled');
  const replay = await service.submit(request);
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.body, { ...settled, replayed: true });
  console.log(JSON.stringify({ check: 'settled-and-replayed', ...settled }, null, 2));
  const cheatService = makeService(true);
  const failed = await wait(await cheatService.submit(cheatRequest), cheatService);
  assert.equal(failed.status, 'failed');
  assert.equal(failed.error, 'SerialUsed');
  assert.notEqual(failed.signature, settled.signature);
  console.log(JSON.stringify({ check: 'cheat-failed-on-chain', ...failed }, null, 2));
} finally {
  await database.close();
}
