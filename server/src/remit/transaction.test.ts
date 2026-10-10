import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { BorshInstructionCoder } from '@anchor-lang/core';
import { Keypair, PublicKey, Transaction, type Connection } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { p256 } from '@noble/curves/nist.js';
import { buildRegistrationTransaction, RegistrationGateway, ALLOWANCE_SPACE, MERCHANT_SPACE } from './transaction.js';
import type { RegistrationPlan } from './types.js';

const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
const deployment = { programId: new PublicKey(idl.address).toBytes(), clusterId: 0, mint: Keypair.generate().publicKey.toBytes() };
const wallets = { team: { funder: Keypair.generate(), feePayer: Keypair.generate() },
  public: { funder: Keypair.generate(), feePayer: Keypair.generate() } };
const plan: RegistrationPlan = { kind: 'payer', pool: 'public', publicKey: P.base64urlEncode(p256.getPublicKey(new Uint8Array(32).fill(5))),
  keyHash: '', allowanceId: '18446744073709551615', expiry: 1800003600,
  policy: { capUnits: '100', offlineLimitUnits: '50', bondUnits: '5', lifetimeSeconds: 3600, earmarks: [],
    daily: { units: '1000', funderLamports: '1000', feeLamports: '1000' } } };
plan.keyHash = P.toHex(P.keyHash(P.base64urlDecode(plan.publicKey)));

test.each(['team', 'public'] as const)('open_allowance ABI and signers use only the %s wallet pair', async pool => {
  const p = { ...plan, pool };
  const tx = buildRegistrationTransaction(deployment, wallets, p);
  const ix = tx.instructions[0]; const decoded = new BorshInstructionCoder(idl).decode(ix.data)!;
  expect(decoded.name).toBe('open_allowance');
  const args = (decoded.data as { args: { allowance_id: { toString(): string }; cap: { toString(): string }; payer_key: number[] } }).args;
  expect(args.allowance_id.toString()).toBe('18446744073709551615'); expect(args.cap.toString()).toBe('100');
  expect(Uint8Array.from(args.payer_key)).toEqual(P.base64urlDecode(plan.publicKey));
  expect(ix.keys[0].pubkey.equals(wallets[pool].funder.publicKey)).toBe(true);
  expect(ix.keys[5].pubkey.equals(getAssociatedTokenAddressSync(new PublicKey(deployment.mint), wallets[pool].funder.publicKey))).toBe(true);
  expect(tx.feePayer?.equals(wallets[pool].feePayer.publicKey)).toBe(true);
  const rpc = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(9)), lastValidBlockHeight: 100 })),
    getFeeForMessage: vi.fn(async () => ({ value: 10 })), getMinimumBalanceForRentExemption: vi.fn(async () => 20),
    sendRawTransaction: vi.fn(async (raw: Buffer, _options: object) => base58.encode(Transaction.from(raw).signature!)),
  };
  const chain = new RegistrationGateway(rpc as unknown as Connection, deployment, wallets);
  const quote = await chain.quote(p); expect(quote.cost).toEqual({ units: '105', funderLamports: '20', feeLamports: '10' });
  const signed = await chain.sign(quote, p); const wire = Transaction.from(Buffer.from(signed.rawTransaction, 'base64'));
  expect(wire.verifySignatures()).toBe(true); expect(wire.signatures).toHaveLength(2);
  await chain.send(signed); expect(rpc.sendRawTransaction.mock.calls[0][1]).toEqual({ skipPreflight: true, maxRetries: 0 });
});

test('merchant rent is paid by its selected fee payer, with no funding-wallet signature', async () => {
  const p: RegistrationPlan = { ...plan, kind: 'merchant', name: 'Shop' };
  const rpc = { getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(9)), lastValidBlockHeight: 100 })),
    getFeeForMessage: vi.fn(async () => ({ value: 10 })), getMinimumBalanceForRentExemption: vi.fn(async () => 20) };
  const chain = new RegistrationGateway(rpc as unknown as Connection, deployment, wallets);
  const quote = await chain.quote(p); expect(quote.cost).toEqual({ units: '0', funderLamports: '0', feeLamports: '30' });
  const signed = await chain.sign(quote, p); const tx = Transaction.from(Buffer.from(signed.rawTransaction, 'base64'));
  expect(tx.signatures).toHaveLength(1); expect(tx.verifySignatures()).toBe(true);
  expect(new BorshInstructionCoder(idl).decode(tx.instructions[0].data)?.name).toBe('register_merchant');
  expect(ALLOWANCE_SPACE).toBe(670); expect(MERCHANT_SPACE).toBe(90);
});

test('only a confirmed allocation collision for the exact PDA permits a retry', async () => {
  const tx = buildRegistrationTransaction(deployment, wallets, plan); const address = tx.instructions[0].keys[2].pubkey.toBase58();
  const status = { confirmationStatus: 'processed', err: { InstructionError: [0, { Custom: 0 }] } };
  const rpc = { getSignatureStatuses: vi.fn(async () => ({ value: [status] })),
    getTransaction: vi.fn(async () => ({ meta: { err: status.err, logMessages: [`Allocate: account ${address} already in use`] } })) };
  const chain = new RegistrationGateway(rpc as unknown as Connection, deployment, wallets);
  const attempt = { signature: 'test', rawTransaction: '', blockhash: 'test', lastValidBlockHeight: 100 };
  expect(await chain.observe(attempt, plan)).toBeNull(); status.confirmationStatus = 'confirmed';
  expect(await chain.observe(attempt, plan)).toBe('collision');
  rpc.getTransaction.mockResolvedValue({ meta: { err: status.err, logMessages: ['Allocate: another account already in use'] } });
  expect(await chain.observe(attempt, plan)).toBe('failed');
});
