import { readFileSync } from 'node:fs';
import { BN, BorshAccountsCoder, BorshInstructionCoder } from '@anchor-lang/core';
import { base58 } from '@scure/base';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram, Transaction, TransactionInstruction, type Connection, type Signer } from '@solana/web3.js';
import * as P from '@lokapay/protocol';
import type { PreparedAttempt } from '../settle/types.js';
import type { PoolName, Quote, RegistrationChain, RegistrationPlan } from './types.js';

const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
const instructions = new BorshInstructionCoder(idl);
const accounts = new BorshAccountsCoder(idl);
// Includes the Anchor discriminator and the maximum 16-entry earmark vector in state.rs.
export const ALLOWANCE_SPACE = 8 + 8 + 32 + 33 + 5 * 8 + 4 + 16 * 32 + 32 + 1;
export const MERCHANT_SPACE = 8 + 33 + 32 + 8 + 8 + 1;
export type Wallets = Record<PoolName, { funder: Signer; feePayer: Signer }>;

function addresses(deployment: P.Deployment, plan: RegistrationPlan) {
  const program = new PublicKey(deployment.programId), mint = new PublicKey(deployment.mint);
  const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program)[0];
  const id = Buffer.alloc(8); id.writeBigUInt64BE(BigInt(plan.allowanceId ?? '0'));
  const vault = pda(Buffer.from('vault'), mint.toBuffer());
  return { program, mint, vault, config: pda(Buffer.from('config')),
    allowance: pda(Buffer.from('allowance'), id), merchant: pda(Buffer.from('merchant'), Buffer.from(plan.keyHash, 'hex')) };
}
export function buildRegistrationTransaction(deployment: P.Deployment, wallets: Wallets, plan: RegistrationPlan): Transaction {
  if (deployment.clusterId !== 0) throw new Error('Registration is devnet sandbox only');
  const a = addresses(deployment, plan), w = wallets[plan.pool];
  const key = (pubkey: PublicKey, isSigner = false, isWritable = false) => ({ pubkey, isSigner, isWritable });
  const payer = plan.kind === 'payer';
  const data = payer ? instructions.encode('open_allowance', { args: {
    allowance_id: new BN(plan.allowanceId!), payer_key: Array.from(P.base64urlDecode(plan.publicKey)),
    cap: new BN(plan.policy.capUnits), offline_limit: new BN(plan.policy.offlineLimitUnits),
    expiry: new BN(plan.expiry), bond: new BN(plan.policy.bondUnits), earmarks: plan.policy.earmarks.map(h => Array.from(P.fromHex(h))),
  } }) : instructions.encode('register_merchant', { public_key: Array.from(P.base64urlDecode(plan.publicKey)) });
  const keys = payer ? [key(w.funder.publicKey, true, true), key(a.config), key(a.allowance, false, true), key(a.vault), key(a.mint),
    key(getAssociatedTokenAddressSync(a.mint, w.funder.publicKey), false, true),
    key(getAssociatedTokenAddressSync(a.mint, a.vault, true), false, true), key(TOKEN_PROGRAM_ID), key(SystemProgram.programId)]
    : [key(w.feePayer.publicKey, true, true), key(a.config), key(a.merchant, false, true), key(SystemProgram.programId)];
  const tx = new Transaction().add(new TransactionInstruction({ programId: a.program, keys, data }));
  tx.feePayer = w.feePayer.publicKey; return tx;
}
export class RegistrationGateway implements RegistrationChain {
  constructor(private readonly connection: Connection, private readonly deployment: P.Deployment, private readonly wallets: Wallets) {}
  async taken(id: string): Promise<boolean> {
    const bytes = Buffer.alloc(8); bytes.writeBigUInt64BE(BigInt(id));
    const address = PublicKey.findProgramAddressSync([Buffer.from('allowance'), bytes], new PublicKey(this.deployment.programId))[0];
    return (await this.connection.getAccountInfo(address, 'confirmed')) !== null;
  }
  async existingMerchant(publicKey: string): Promise<string | null> {
    const program = new PublicKey(this.deployment.programId), hash = P.keyHash(P.base64urlDecode(publicKey));
    const address = PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(hash)], program)[0];
    const account = await this.connection.getAccountInfo(address, 'confirmed');
    if (!account) return null;
    if (!account.owner.equals(program)) throw new Error('Unexpected merchant owner');
    const decoded = accounts.decode('Merchant', account.data);
    if (!P.equalBytes(Uint8Array.from(decoded.public_key), P.base64urlDecode(publicKey))
      || !P.equalBytes(Uint8Array.from(decoded.key_hash), hash)) throw new Error('Merchant key mismatch');
    // Recover only verifiable evidence, never fabricate a registration signature. RPC history
    // outside this bounded search requires operator recovery before issuing a certificate.
    let before: string | undefined;
    for (let page = 0; page < 10; page++) {
      const signatures = await this.connection.getSignaturesForAddress(address, { before, limit: 100 }, 'confirmed');
      for (const item of signatures) {
        if (item.err !== null) continue;
        const tx = await this.connection.getParsedTransaction(item.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (!tx?.meta || tx.meta.err !== null) continue;
        const all = [...tx.transaction.message.instructions, ...(tx.meta.innerInstructions ?? []).flatMap(group => group.instructions)];
        for (const ix of all) {
          if (!ix.programId.equals(program) || !('data' in ix) || !ix.accounts[2]?.equals(address)) continue;
          const instruction = instructions.decode(Buffer.from(base58.decode(ix.data)));
          if (instruction?.name === 'register_merchant'
            && P.equalBytes(Uint8Array.from((instruction.data as { public_key: number[] }).public_key), P.base64urlDecode(publicKey))) return item.signature;
        }
      }
      if (signatures.length < 100) break;
      before = signatures.at(-1)!.signature;
    }
    throw new Error('Merchant creation evidence is unavailable');
  }
  async quote(plan: RegistrationPlan): Promise<Quote> {
    const latest = await this.connection.getLatestBlockhash('confirmed');
    const tx = buildRegistrationTransaction(this.deployment, this.wallets, plan); tx.recentBlockhash = latest.blockhash;
    const fee = (await this.connection.getFeeForMessage(tx.compileMessage(), 'confirmed')).value;
    const rent = await this.connection.getMinimumBalanceForRentExemption(plan.kind === 'payer' ? ALLOWANCE_SPACE : MERCHANT_SPACE, 'confirmed');
    if (fee === null || !Number.isSafeInteger(fee) || fee < 0 || !Number.isSafeInteger(rent) || rent < 0) throw new Error('Unavailable cost quote');
    return { ...latest, message: tx.serializeMessage().toString('base64'), cost: plan.kind === 'payer'
      ? { units: (BigInt(plan.policy.capUnits) + BigInt(plan.policy.bondUnits)).toString(), funderLamports: String(rent), feeLamports: String(fee) }
      : { units: '0', funderLamports: '0', feeLamports: (BigInt(fee) + BigInt(rent)).toString() } };
  }
  async sign(quote: Quote, plan: RegistrationPlan): Promise<PreparedAttempt> {
    const tx = buildRegistrationTransaction(this.deployment, this.wallets, plan); tx.recentBlockhash = quote.blockhash;
    if (tx.serializeMessage().toString('base64') !== quote.message) throw new Error('Quoted transaction changed');
    const wallet = this.wallets[plan.pool];
    tx.sign(...(plan.kind === 'payer' ? [wallet.feePayer, wallet.funder] : [wallet.feePayer]));
    return { signature: base58.encode(tx.signature!), rawTransaction: tx.serialize().toString('base64'),
      blockhash: quote.blockhash, lastValidBlockHeight: quote.lastValidBlockHeight };
  }
  async send(attempt: PreparedAttempt): Promise<void> {
    const signature = await this.connection.sendRawTransaction(Buffer.from(attempt.rawTransaction, 'base64'), { skipPreflight: true, maxRetries: 0 });
    if (signature !== attempt.signature) throw new Error('Unexpected RPC signature');
  }
  async blockHeight(): Promise<number> { return this.connection.getBlockHeight('confirmed'); }
  async observe(attempt: PreparedAttempt, plan: RegistrationPlan): Promise<'ok' | 'collision' | 'failed' | null> {
    return (await this.lookup(attempt, plan)).outcome;
  }
  async lookup(attempt: PreparedAttempt, plan: RegistrationPlan): Promise<{ found: boolean; outcome: 'ok' | 'collision' | 'failed' | null }> {
    const { value: [status] } = await this.connection.getSignatureStatuses([attempt.signature], { searchTransactionHistory: true });
    if (!status) return { found: false, outcome: null };
    if (!['confirmed', 'finalized'].includes(status.confirmationStatus ?? '')) return { found: true, outcome: null };
    if (status.err === null) return { found: true, outcome: 'ok' };
    if (JSON.stringify(status.err) === JSON.stringify({ InstructionError: [0, { Custom: 0 }] })) {
      const tx = await this.connection.getTransaction(attempt.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const a = addresses(this.deployment, plan), expected = (plan.kind === 'payer' ? a.allowance : a.merchant).toBase58();
      if (tx?.meta?.err && tx.meta.logMessages?.some(line => line.startsWith('Allocate:') && line.includes(expected) && line.includes('already in use'))) return { found: true, outcome: 'collision' };
    }
    return { found: true, outcome: 'failed' };
  }
}
