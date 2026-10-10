import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { base58 } from '@scure/base';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, VersionedTransaction, clusterApiUrl, type Signer } from '@solana/web3.js';
import * as P from '@lokapay/protocol';

export function buildMainnetProof(wire: Uint8Array): Transaction {
  assert.equal(wire.length, 238, 'length: a note wire must contain exactly 238 bytes');
  const fields = P.decodeNote(wire.slice(0, 141));
  assert(fields.clusterId === 0 || fields.clusterId === 1, 'Unsupported note cluster');
  // This proves a signature over the original note bytes, not mainnet payment or hardware provenance.
  const note = P.validateNoteWire(wire, { programId: fields.programId, mint: fields.mint, clusterId: fields.clusterId });
  return new Transaction().add(new TransactionInstruction({ programId: new PublicKey(P.SECP256R1_PROGRAM_ID), keys: [],
    data: Buffer.from(P.secp256r1InstructionData([{ publicKey: note.payerPublicKey, signature: note.signature, message: note.noteBytes }])) }));
}

export async function runMainnetProof(options: { connection: Connection; feePayer: Signer; wire: Uint8Array; send?: boolean;
  print: (value: unknown) => void }): Promise<{ signature: string; explorer: string } | null> {
  const tx = buildMainnetProof(options.wire);
  const { connection, feePayer, print } = options;
  assert.equal(await connection.getGenesisHash(), '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', 'RPC is not mainnet');
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = feePayer.publicKey; tx.recentBlockhash = latest.blockhash;
  const signed = new VersionedTransaction(tx.compileMessage()); signed.sign([feePayer]);
  const simulation = await connection.simulateTransaction(signed, { sigVerify: true, commitment: 'confirmed' });
  print({ network: 'mainnet-beta', scope: 'P-256 signature verification only; no program invocation or custody',
    provenance: 'Signature verification does not establish Secure Enclave provenance.', simulation: simulation.value });
  assert.equal(simulation.value.err, null, 'Simulation failed; nothing sent');
  if (!options.send) return null;
  const signature = base58.encode(signed.signatures[0]);
  const result = { signature, explorer: `https://explorer.solana.com/tx/${signature}` };
  print({ status: 'prepared', ...result });
  const returned = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 0 });
  assert.equal(returned, signature, 'Unexpected RPC signature; inspect the prepared signature, do not resend');
  print({ status: 'submitted', ...result });
  return result;
}

export async function mainnetProofCli(args = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({ args, options: { 'note-wire': { type: 'string' }, 'fee-payer': { type: 'string' },
    'rpc-url': { type: 'string' }, send: { type: 'boolean', default: false } } });
  assert(values['note-wire'] && values['fee-payer'], 'Use --note-wire <238-byte binary file> --fee-payer <outside-repo keypair> [--send]');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const keyPath = resolve(values['fee-payer']), keyRelative = relative(root, keyPath);
  assert(keyRelative.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')) || isAbsolute(keyRelative), 'Fee payer keypair must be outside the repository');
  const secret = JSON.parse(readFileSync(keyPath, 'utf8'));
  assert(Array.isArray(secret) && secret.length === 64 && secret.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Invalid fee payer keypair');
  await runMainnetProof({ connection: new Connection(values['rpc-url'] ?? clusterApiUrl('mainnet-beta'), 'confirmed'),
    feePayer: Keypair.fromSecretKey(Uint8Array.from(secret)), wire: readFileSync(values['note-wire']), send: values.send,
    print: value => console.log(JSON.stringify(value)) });
}
