import { readFileSync } from 'node:fs';
import { base58 } from '@scure/base';
import { BorshAccountsCoder } from '@anchor-lang/core';
import * as P from '@lokapay/protocol';
import {
  Connection, PublicKey, Transaction, TransactionInstruction,
  type Signer, type TransactionError,
} from '@solana/web3.js';
import type { ChainDecision, ChainGateway, IdentityRefusal, PreparedAttempt } from './types.js';

const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
const redeem = idl.instructions.find((ix: { name: string }) => ix.name === 'redeem_note');
if (!redeem || redeem.args[0]?.type?.array?.[1] !== P.SIZES.NOTE_V1) throw new Error('Unexpected redeem_note IDL');

export function buildRedeemTransaction(note: P.ValidatedNote): Transaction {
  const program = new PublicKey(note.note.programId);
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const id = Buffer.alloc(8);
  id.writeBigUInt64BE(note.note.allowanceId);
  const precompile = new TransactionInstruction({
    programId: new PublicKey(P.SECP256R1_PROGRAM_ID), keys: [],
    data: Buffer.from(P.secp256r1InstructionData([{
      publicKey: note.payerPublicKey, signature: note.signature, message: note.noteBytes,
    }])),
  });
  const instruction = new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: pda(Buffer.from('config')), isSigner: false, isWritable: false },
      { pubkey: pda(Buffer.from('allowance'), id), isSigner: false, isWritable: true },
      { pubkey: pda(Buffer.from('merchant'), Buffer.from(note.note.payeeKeyHash)), isSigner: false, isWritable: true },
      { pubkey: new PublicKey(P.INSTRUCTIONS_SYSVAR_ID), isSigner: false, isWritable: false },
    ],
    // Anchor's fixed [u8;141] has no length prefix. The discriminator comes from the reviewed IDL.
    data: Buffer.concat([Buffer.from(redeem.discriminator), Buffer.from(note.noteBytes)]),
  });
  return new Transaction().add(precompile, instruction);
}

export function decodeChainError(error: TransactionError | null): { error: string | null; errorCode: number | null } {
  if (error === null) return { error: null, errorCode: 0 };
  const generic = { error: 'TransactionFailed', errorCode: null };
  if (typeof error !== 'object' || !('InstructionError' in error)) return generic;
  const detail = (error as { InstructionError: [number, unknown] }).InstructionError;
  // Only redeem_note (instruction 1) owns the error-code namespace below.
  if (detail[0] !== 1 || !detail[1] || typeof detail[1] !== 'object' || !('Custom' in detail[1])) return generic;
  const code = (detail[1] as { Custom: number }).Custom;
  if (!Number.isInteger(code) || code <= 0 || code > 65535) return generic;
  const named = idl.errors.find((entry: { code: number }) => entry.code === code);
  return { error: named?.name ?? `ProgramError${code}`, errorCode: code };
}

export class SolanaGateway implements ChainGateway {
  constructor(private readonly connection: Connection, private readonly feePayer: Signer) {}

  async checkIdentity(note: P.ValidatedNote): Promise<IdentityRefusal | null> {
    const program = new PublicKey(note.note.programId);
    const id = Buffer.alloc(8); id.writeBigUInt64BE(note.note.allowanceId);
    const address = PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0];
    const account = await this.connection.getAccountInfo(address, 'confirmed');
    if (!account || !account.owner.equals(program)) return 'unknown_allowance';
    const coder = new BorshAccountsCoder(idl);
    let allowance;
    try {
      allowance = coder.decode('Allowance', account.data);
      if (allowance.id.toString() !== note.note.allowanceId.toString()) return 'unknown_allowance';
    } catch { return 'unknown_allowance'; }
    const merchantAddress = PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(note.note.payeeKeyHash)], program)[0];
    const merchantAccount = await this.connection.getAccountInfo(merchantAddress, 'confirmed');
    if (!merchantAccount || !merchantAccount.owner.equals(program)) return 'unknown_merchant';
    try {
      const merchant = coder.decode('Merchant', merchantAccount.data);
      const hash = Uint8Array.from(merchant.key_hash);
      if (!P.equalBytes(hash, note.note.payeeKeyHash)
        || !P.equalBytes(P.keyHash(Uint8Array.from(merchant.public_key)), hash)) return 'unknown_merchant';
    } catch { return 'unknown_merchant'; }
    return P.equalBytes(Uint8Array.from(allowance.payer_key), note.payerPublicKey) ? null : 'payer_mismatch';
  }

  async prepare(note: P.ValidatedNote): Promise<PreparedAttempt> {
    const latest = await this.connection.getLatestBlockhash('confirmed');
    const transaction = buildRedeemTransaction(note);
    transaction.feePayer = this.feePayer.publicKey;
    transaction.recentBlockhash = latest.blockhash;
    transaction.sign(this.feePayer);
    if (!transaction.signature) throw new Error('Missing transaction signature');
    return { signature: base58.encode(transaction.signature), rawTransaction: transaction.serialize().toString('base64'),
      blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight };
  }

  async send(attempt: PreparedAttempt): Promise<void> {
    // No simulation or state lookup. Disable RPC rebroadcast retries as well as application retries.
    const signature = await this.connection.sendRawTransaction(Buffer.from(attempt.rawTransaction, 'base64'),
      { skipPreflight: true, maxRetries: 0 });
    if (signature !== attempt.signature) throw new Error('RPC returned a different transaction signature');
  }

  async observe(signature: string): Promise<ChainDecision | null> {
    return (await this.lookup(signature)).decision;
  }

  async blockHeight(): Promise<number> { return this.connection.getBlockHeight('confirmed'); }

  async lookup(signature: string): Promise<{ found: boolean; decision: ChainDecision | null }> {
    const { value: [status] } = await this.connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    if (!status) return { found: false, decision: null };
    if (!['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')) return { found: true, decision: null };
    const result = decodeChainError(status.err);
    const blockTime = await this.connection.getBlockTime(status.slot);
    if (blockTime === null || !Number.isSafeInteger(blockTime) || !Number.isSafeInteger(status.slot)) return { found: true, decision: null };
    return { found: true, decision: { slot: status.slot, blockTime, ...result } };
  }
}
