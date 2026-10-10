import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as anchor from '@anchor-lang/core';
import { p256 } from '@noble/curves/nist.js';
import {
  createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo,
  getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import {
  Connection, Keypair, PublicKey, SystemProgram, SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction, TransactionInstruction,
} from '@solana/web3.js';
import * as P from '@lokapay/protocol';
import { expect } from 'vitest';

// Software keys derived from public labels, used only on an isolated local validator.
export const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest();
const key = (label: string) => {
  const secret = hash(Buffer.from(`LOKA Pay LOCAL TEST ONLY ${label}`));
  const publicKey = Buffer.from(p256.getPublicKey(secret, true));
  return { secret, publicKey, keyHash: hash(publicKey) };
};
export const payer = key('payer');
export const merchantA = key('merchant A');
export const merchantB = key('merchant B');
export const impostor = key('impostor');
export const bn = (n: bigint | number) => new anchor.BN(n.toString());
export const u64 = (n: bigint) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(n); return b; };
export const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
let nextId = 1000n;
let fixturePromise: Promise<Fixture> | undefined;
export interface Fixture {
  provider: anchor.AnchorProvider;
  program: anchor.Program;
  wallet: Keypair;
  mint: PublicKey;
  source: PublicKey;
  config: PublicKey;
  vault: PublicKey;
  vaultTokens: PublicKey;
  merchantA: PublicKey;
  merchantB: PublicKey;
  deployment: P.Deployment;
}
export const pda = (program: anchor.Program, ...seeds: Uint8Array[]) =>
  PublicKey.findProgramAddressSync(seeds.map(seed => Buffer.from(seed)), program.programId)[0];
export const merchantPda = (f: Fixture, keyHash: Uint8Array) => pda(f.program, Buffer.from('merchant'), keyHash);
export const allowancePda = (f: Fixture, id: bigint) => pda(f.program, Buffer.from('allowance'), u64(id));
export async function send(f: Fixture, instructions: TransactionInstruction[], signers: Keypair[] = []) {
  return f.provider.sendAndConfirm(new Transaction().add(...instructions), signers,
    { commitment: 'confirmed', preflightCommitment: 'confirmed' });
}
export async function fixture(): Promise<Fixture> {
  fixturePromise ??= (async () => {
    const environment = anchor.AnchorProvider.env();
    const url = new URL(environment.connection.rpcEndpoint);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:') {
      throw new Error('Tests refuse any RPC except an HTTP loopback local validator');
    }
    const provider = new anchor.AnchorProvider(new Connection(url.href, 'confirmed'), environment.wallet,
      { commitment: 'confirmed', preflightCommitment: 'confirmed' });
    const wallet = (provider.wallet as anchor.Wallet).payer;
    const idl = JSON.parse(readFileSync(new URL('../../target/idl/loka_vault.json', import.meta.url), 'utf8'));
    const program = new anchor.Program(idl, provider);
    const mint = await createMint(provider.connection, wallet, wallet.publicKey, null, 6);
    const source = (await getOrCreateAssociatedTokenAccount(provider.connection, wallet, mint, wallet.publicKey)).address;
    await mintTo(provider.connection, wallet, mint, source, wallet, 1_000_000_000_000n);
    const config = pda(program, Buffer.from('config'));
    const vault = pda(program, Buffer.from('vault'), mint.toBytes());
    const vaultTokens = getAssociatedTokenAddressSync(mint, vault, true);
    const f = {
      provider, program, wallet, mint, source, config, vault, vaultTokens,
      merchantA: pda(program, Buffer.from('merchant'), merchantA.keyHash),
      merchantB: pda(program, Buffer.from('merchant'), merchantB.keyHash),
      deployment: { programId: program.programId.toBytes(), clusterId: 0, mint: mint.toBytes() },
    };
    const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()],
      new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
    const accounts = {
      authority: wallet.publicKey, program: program.programId, programData,
      config, vault, mint, vaultTokens, tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    };
    const stranger = Keypair.generate();
    await send(f, [SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: stranger.publicKey, lamports: 100_000_000 })]);
    // Anyone can precreate a PDA's ATA. This must not deny vault initialization.
    const precreated = await getOrCreateAssociatedTokenAccount(provider.connection, stranger, mint, vault, true);
    expect(precreated.address.equals(vaultTokens)).toBe(true);
    // An arbitrary signer cannot seize deployment configuration before its owner initializes.
    await expect(program.methods.initializeVault(0).accountsStrict({ ...accounts, authority: stranger.publicKey })
      .signers([stranger]).rpc()).rejects.toThrow(/InvalidAuthority/);
    expect(await provider.connection.getAccountInfo(config)).toBeNull();
    await program.methods.initializeVault(0).accountsStrict(accounts).rpc();
    for (const k of [merchantA, merchantB]) {
      await program.methods.registerMerchant(Array.from(k.publicKey)).accountsStrict({
        payer: wallet.publicKey, config, merchant: merchantPda(f, k.keyHash), systemProgram: SystemProgram.programId,
      }).rpc();
    }
    return f;
  })();
  return fixturePromise;
}
export interface Allowance { id: bigint; address: PublicKey; expiry: bigint; cap: bigint }
export async function open(f: Fixture, overrides: Record<string, unknown> = {}, accountOverrides = {}): Promise<Allowance> {
  const id = nextId++;
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
  const args = {
    allowanceId: bn(id), payerKey: Array.from(payer.publicKey), cap: bn(1_000_000),
    offlineLimit: bn(100_000), expiry: bn(expiry), bond: bn(100_000), earmarks: [], ...overrides,
  };
  const address = allowancePda(f, BigInt(args.allowanceId.toString()));
  await f.program.methods.openAllowance(args).accountsStrict({
    funder: f.wallet.publicKey, config: f.config, allowance: address, vault: f.vault,
    mint: f.mint, source: f.source, vaultTokens: f.vaultTokens,
    tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, ...accountOverrides,
  }).rpc();
  return { id: BigInt(args.allowanceId.toString()), address, expiry: BigInt(args.expiry.toString()), cap: BigInt(args.cap.toString()) };
}
export function note(f: Fixture, a: Allowance, overrides: Partial<P.NoteFields> = {}) {
  return Buffer.from(P.encodeNote(f.deployment, {
    allowanceId: a.id, payeeKeyHash: merchantA.keyHash, amount: 100_000n, serial: 0, expiry: a.expiry, ...overrides,
  }));
}
export function precompile(message: Uint8Array, signingKey = payer): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(P.SECP256R1_PROGRAM_ID), keys: [],
    data: Buffer.from(P.secp256r1InstructionData([{
      publicKey: signingKey.publicKey, signature: p256.sign(message, signingKey.secret), message,
    }])),
  });
}
export async function redeemIx(f: Fixture, a: Allowance, bytes: Uint8Array, extra = {}) {
  return f.program.methods.redeemNote(Array.from(bytes)).accountsStrict({
    config: f.config, allowance: a.address, merchant: f.merchantA,
    instructions: SYSVAR_INSTRUCTIONS_PUBKEY, ...extra,
  }).instruction();
}
export const allowanceAccount = (f: Fixture, a: Allowance) => (f.program.account as any).allowance.fetch(a.address);
export const merchantAccount = (f: Fixture, address = f.merchantA) => (f.program.account as any).merchant.fetch(address);
export async function snapshot(f: Fixture, a: Allowance) {
  return JSON.stringify({ allowance: await allowanceAccount(f, a), merchant: await merchantAccount(f),
    other: await merchantAccount(f, f.merchantB), vault: (await getAccount(f.provider.connection, f.vaultTokens)).amount.toString() });
}
export async function refuse(f: Fixture, a: Allowance, instructions: TransactionInstruction[], error?: RegExp) {
  const before = await snapshot(f, a);
  const result = send(f, instructions);
  if (error) await expect(result).rejects.toThrow(error); else await expect(result).rejects.toThrow();
  expect(await snapshot(f, a)).toBe(before);
}
export async function withdrawal(f: Fixture, amount = 100_000n, overrides: Partial<Parameters<typeof P.encodeWithdraw>[1]> = {}) {
  const destination = Keypair.generate().publicKey;
  const destinationTokens = (await getOrCreateAssociatedTokenAccount(f.provider.connection, f.wallet, f.mint, destination)).address;
  const counter = BigInt((await merchantAccount(f)).withdrawCounter.toString());
  const bytes = Buffer.from(P.encodeWithdraw(f.deployment, { merchantKeyHash: merchantA.keyHash, destination: destination.toBytes(), amount, counter, ...overrides }));
  const accounts = {
    config: f.config, merchant: f.merchantA, vault: f.vault, vaultTokens: f.vaultTokens,
    mint: f.mint, destination, destinationTokens, tokenProgram: TOKEN_PROGRAM_ID, instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
  };
  const ix = await f.program.methods.withdraw(Array.from(bytes)).accountsStrict(accounts).instruction();
  return { bytes, accounts, ix, destinationTokens, amount, counter };
}
