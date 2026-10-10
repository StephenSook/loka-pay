// Invoked only by the user's explicit devnet commands. No provisioning, funding or deployment.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import anchor from '@anchor-lang/core';
import { base58 } from '@scure/base';
import { p256 } from '@noble/curves/nist.js';
import { Connection, Keypair, PublicKey, VersionedTransaction, type Signer } from '@solana/web3.js';
import * as P from '@lokapay/protocol';
import { buildRedeemTransaction } from '../settle/transaction.js';
import { limitsFromSimulation, summarizeRows, type RedeemRow } from './measurement.js';
import { saveJournal } from './journal.js';

interface RunInput { payerKeyPath: string; feePayerPath: string; allowanceId: string; payeeKeyHash: string;
  amountUnits: string; expiry: string; startSerial?: number; rpcUrl?: string }
export function softwareNote(deployment: P.Deployment, input: Pick<RunInput, 'allowanceId' | 'payeeKeyHash' | 'amountUnits' | 'expiry'>,
  secret: Uint8Array, serial: number): P.ValidatedNote {
  const bytes = P.encodeNote(deployment, { allowanceId: BigInt(input.allowanceId), payeeKeyHash: P.fromHex(input.payeeKeyHash),
    amount: BigInt(input.amountUnits), serial, expiry: BigInt(input.expiry) });
  return P.validateNoteWire(Uint8Array.from([...bytes, ...p256.sign(bytes, secret, { lowS: true }), ...p256.getPublicKey(secret)]), deployment);
}
export async function measureLimits(connection: Connection, note: P.ValidatedNote, payer: Signer) {
  const simulation = buildRedeemTransaction(note, { units: 1400000, loadedBytes: 64 * 1024 * 1024 });
  simulation.feePayer = payer.publicKey; simulation.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const simulated = await connection.simulateTransaction(new VersionedTransaction(simulation.compileMessage()), {
    replaceRecentBlockhash: true, sigVerify: false, commitment: 'confirmed',
  });
  assert.equal(simulated.value.err, null, 'Simulation refused the sample redeem');
  const value = simulated.value as typeof simulated.value & { loadedAccountsDataSize?: number };
  return { simulation: { units: value.unitsConsumed, loadedBytes: value.loadedAccountsDataSize }, limits: limitsFromSimulation(value.unitsConsumed, value.loadedAccountsDataSize) };
}
export interface MeasuredAttempt { serial: number; signature: string; lastValidBlockHeight: number; status: string }
export async function sendMeasuredRedeems(options: { connection: Connection; feePayer: Signer; note: (serial: number) => P.ValidatedNote;
  source: 'measurement' | 'load_test'; count: number; start: number; limits: { units: number; loadedBytes: number };
  rows: RedeemRow[]; attempts: MeasuredAttempt[]; save: () => void; wait?: () => Promise<void> }): Promise<void> {
  const { connection, feePayer, count, start, limits, rows, attempts, save } = options;
  assert(Number.isSafeInteger(count) && count > 0 && Number.isSafeInteger(start) && start >= 0 && start + count <= 256, 'Invalid serial range');
  for (let serial = start; serial < start + count; serial++) {
    const latest = await connection.getLatestBlockhash('confirmed');
    const tx = buildRedeemTransaction(options.note(serial), limits);
    tx.feePayer = feePayer.publicKey; tx.recentBlockhash = latest.blockhash; tx.sign(feePayer);
    const signature = base58.encode(tx.signature!);
    const attempt = { serial, signature, lastValidBlockHeight: latest.lastValidBlockHeight, status: 'prepared' };
    attempts.push(attempt); save(); // Persist the signature before the first possible broadcast.
    const returned = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 0 });
    assert.equal(returned, signature); attempt.status = 'pending'; save();
    let transaction = null;
    for (let poll = 0; poll < 30 && !transaction; poll++) {
      transaction = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!transaction) await (options.wait ?? (() => new Promise(resolve => setTimeout(resolve, 1000))))();
    }
    assert(transaction?.meta, 'No confirmed metadata yet. Keep this output; do not rerun the allowance.');
    assert(Number.isSafeInteger(transaction.meta.computeUnitsConsumed), 'RPC did not report measured compute units');
    rows.push({ signature, slot: transaction.slot, feeLamports: transaction.meta.fee,
      computeUnits: transaction.meta.computeUnitsConsumed!, error: transaction.meta.err, source: options.source });
    attempt.status = transaction.meta.err === null ? 'settled' : 'failed'; save();
  }
}
export async function runRedeems(source: 'measurement' | 'load_test'): Promise<void> {
  const { values } = parseArgs({ options: { 'run-devnet': { type: 'boolean' }, input: { type: 'string' }, output: { type: 'string' } } });
  assert(values['run-devnet'] && values.input, 'Requires --run-devnet --input <outside-repo JSON>. This spends devnet fees.');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const outside = (path: string) => {
    const rel = relative(root, resolve(path));
    assert(isAbsolute(path) && (rel.startsWith('..') || isAbsolute(rel)), 'Key and input paths must be absolute and outside the repository');
    return path;
  };
  const input = JSON.parse(readFileSync(outside(values.input), 'utf8')) as RunInput;
  const secretHex = readFileSync(outside(input.payerKeyPath), 'utf8').trim();
  assert(/^[0-9a-fA-F]{64}$/.test(secretHex), 'Software P-256 key must be a 32-byte hex file outside the repo');
  const secret = P.fromHex(secretHex);
  const feePayer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(outside(input.feePayerPath), 'utf8'))));
  const pins = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8'));
  assert(pins.cluster === 'devnet', 'Only devnet is supported');
  const deployment = { programId: new PublicKey(pins.programId).toBytes(), mint: new PublicKey(pins.mint).toBytes(), clusterId: 0 };
  const connection = new Connection(input.rpcUrl ?? 'https://api.devnet.solana.com', 'confirmed');
  // Custom RPCs must prove they serve devnet before any transaction is signed.
  assert.equal(await connection.getGenesisHash(), 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1', 'RPC is not devnet');
  const count = source === 'measurement' ? 20 : 256, start = input.startSerial ?? 0;
  assert(Number.isSafeInteger(start) && start >= 0 && start + count <= 256, 'Serial range must fit the allowance bitmap');
  const program = new PublicKey(pins.programId), id = Buffer.alloc(8); id.writeBigUInt64BE(BigInt(input.allowanceId));
  const address = PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0];
  const account = await connection.getAccountInfo(address, 'confirmed');
  assert(account && account.owner.equals(program), 'Existing software-key allowance is required');
  const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
  const allowance = new anchor.BorshAccountsCoder(idl).decode('Allowance', account.data);
  assert(P.equalBytes(Uint8Array.from(allowance.payer_key), p256.getPublicKey(secret)), 'Software key does not own this allowance');
  assert(BigInt(input.amountUnits) > 0n && BigInt(input.amountUnits) * BigInt(count) <= BigInt(allowance.cap.toString()) - BigInt(allowance.redeemed.toString()), 'Insufficient allowance capacity');
  assert(BigInt(input.expiry) > BigInt(Math.floor(Date.now() / 1000)) && BigInt(input.expiry) <= BigInt(allowance.expiry.toString()), 'Invalid note expiry');
  for (let serial = start; serial < start + count; serial++) assert((allowance.used_serials[serial >> 3] & (1 << (serial % 8))) === 0, 'Use a fresh serial range');
  const output = resolve(values.output ?? resolve(root, 'measurements', source === 'measurement' ? 'redeem.json' : 'drain.json'));
  assert(!existsSync(output), 'Output already exists. Inspect its saved attempts; never repeat an uncertain send.');
  const sample = softwareNote(deployment, input, secret, start);
  const { simulation, limits } = await measureLimits(connection, sample, feePayer);
  const rows: RedeemRow[] = [];
  const attempts: MeasuredAttempt[] = [];
  let rpc429 = 0;
  const report: Record<string, unknown> = { source, network: 'devnet', signer: 'software P-256', programId: pins.programId,
    generatedAt: new Date().toISOString(), simulation, limits, rows, attempts, rpc429,
    complete: false, scope: 'Sequential direct-chain redeems including metadata polling. This is not server or merchant-outbox throughput.' };
  mkdirSync(dirname(output), { recursive: true });
  const save = () => saveJournal(output, report);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  const started = performance.now();
  try {
    await sendMeasuredRedeems({ connection, feePayer, note: serial => softwareNote(deployment, input, secret, serial), source, count, start, limits, rows, attempts, save });
  } catch (error) {
    if (/429/.test(String(error))) rpc429++;
    report.failure = 'Run interrupted. Inspect saved signatures with history search before any manual recovery.';
    throw error;
  } finally {
    const elapsedSeconds = (performance.now() - started) / 1000;
    const successes = rows.filter(row => row.error === null).length;
    const units = rows.map(row => row.computeUnits).sort((a, b) => a - b), mid = Math.floor(units.length / 2);
    Object.assign(report, { complete: rows.length === count, rpc429, elapsedSeconds, successes, failed: rows.length - successes,
      paymentsPerSecond: successes / elapsedSeconds, medianComputeUnits: units.length ? (units.length % 2 ? units[mid] : (units[mid - 1] + units[mid]) / 2) : null,
      totalFeeLamports: rows.reduce((sum, row) => sum + BigInt(row.feeLamports), 0n).toString(),
      headline: source === 'measurement' ? summarizeRows(rows) : null, headlineExcluded: source === 'load_test' });
    save(); secret.fill(0);
  }
}
