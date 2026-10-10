import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import * as anchor from '@anchor-lang/core';
import * as P from '@lokapay/protocol';
import { base58 } from '@scure/base';
import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { buildRedeemTransaction, decodeChainError, SolanaGateway } from './transaction.js';

const vectors = JSON.parse(readFileSync(new URL('../../../protocol/vectors/payment-v1.json', import.meta.url), 'utf8'));
const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
const deployment = { programId: P.fromHex(vectors.constants.programIdHex), clusterId: 0, mint: P.fromHex(vectors.constants.mintHex) };
const validated = P.validateNoteWire(P.fromHex(vectors.notes[0].wireHex), deployment);

test('identity checks distinguish missing records and payer mismatch without inspecting spend state', async () => {
  const coder = new anchor.BorshAccountsCoder(idl);
  const fields = { id: new anchor.BN(validated.note.allowanceId.toString()), funder: Keypair.generate().publicKey,
    payer_key: Array.from(validated.payerPublicKey), cap: new anchor.BN(0), redeemed: new anchor.BN(999),
    offline_limit: new anchor.BN(0), expiry: new anchor.BN(0), bond: new anchor.BN(0), earmarks: [], used_serials: Array(32).fill(255), bump: 1 };
  const account = { owner: new PublicKey(deployment.programId), data: await coder.encode('Allowance', fields) };
  const merchant = { owner: new PublicKey(deployment.programId), data: await coder.encode('Merchant', {
    public_key: Array.from(P.fromHex(vectors.keys.merchantA.publicKeyHex)), key_hash: Array.from(validated.note.payeeKeyHash),
    balance: new anchor.BN(999), withdraw_counter: new anchor.BN(0), bump: 1,
  }) };
  const program = new PublicKey(deployment.programId);
  const merchantAddress = PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(validated.note.payeeKeyHash)], program)[0];
  const id = Buffer.alloc(8); id.writeBigUInt64BE(validated.note.allowanceId);
  const allowanceAddress = PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0];
  const records = new Map([[allowanceAddress.toBase58(), account], [merchantAddress.toBase58(), merchant]]);
  const rpc = { getAccountInfo: vi.fn(async (key: PublicKey) => records.get(key.toBase58()) ?? null) };
  const gateway = new SolanaGateway(rpc as unknown as Connection, Keypair.generate());
  expect(await gateway.checkIdentity(validated)).toBeNull();
  account.data = await coder.encode('Allowance', { ...fields, payer_key: Array(33).fill(2) });
  expect(await gateway.checkIdentity(validated)).toBe('payer_mismatch');
  account.data = await coder.encode('Allowance', { ...fields, id: new anchor.BN(1) });
  expect(await gateway.checkIdentity(validated)).toBe('unknown_allowance');
  account.data = Buffer.alloc(account.data.length); expect(await gateway.checkIdentity(validated)).toBe('unknown_allowance');
  account.data = await coder.encode('Allowance', fields); account.owner = Keypair.generate().publicKey;
  expect(await gateway.checkIdentity(validated)).toBe('unknown_allowance');
  account.owner = program;
  records.delete(allowanceAddress.toBase58()); expect(await gateway.checkIdentity(validated)).toBe('unknown_allowance');
  records.set(allowanceAddress.toBase58(), account);
  records.delete(merchantAddress.toBase58()); expect(await gateway.checkIdentity(validated)).toBe('unknown_merchant');
  records.set(merchantAddress.toBase58(), merchant);
  merchant.owner = Keypair.generate().publicKey; expect(await gateway.checkIdentity(validated)).toBe('unknown_merchant');
  merchant.owner = program; merchant.data = Buffer.alloc(merchant.data.length);
  expect(await gateway.checkIdentity(validated)).toBe('unknown_merchant');
});

test.each(vectors.notes as { name: string; wireHex: string; precompileDataHex: string }[])('builds exact precompile bytes and Anchor ABI for $name', vector => {
  const note = P.validateNoteWire(P.fromHex(vector.wireHex), deployment);
  const transaction = buildRedeemTransaction(note);
  expect(transaction.instructions).toHaveLength(2);
  const [precompile, redeem] = transaction.instructions;
  expect(precompile.programId.toBase58()).toBe(P.SECP256R1_PROGRAM_ID);
  expect(precompile.data.toString('hex')).toBe(vector.precompileDataHex);
  const coder = new anchor.BorshInstructionCoder(idl);
  const decoded = coder.decode(redeem.data)!;
  expect(decoded.name).toBe('redeem_note');
  expect(Buffer.from((decoded.data as { note: number[] }).note)).toEqual(Buffer.from(note.noteBytes));
  const programId = new PublicKey(deployment.programId);
  const id = Buffer.alloc(8); id.writeBigUInt64BE(note.note.allowanceId);
  expect(redeem.keys[1].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], programId)[0])).toBe(true);
  expect(redeem.keys[2].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(note.note.payeeKeyHash)], programId)[0])).toBe(true);
  expect(redeem.keys[3].pubkey.toBase58()).toBe(P.INSTRUCTIONS_SYSVAR_ID);
  expect(redeem.keys.map(key => [key.isSigner, key.isWritable])).toEqual([[false, false], [false, true], [false, true], [false, false]]);
});

test('signs one transaction, skips preflight, sets zero retries and never reads program state', async () => {
  const payer = Keypair.generate(); // Ephemeral local signing test only.
  const connection = {
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(async (bytes: Buffer) => base58.encode(Transaction.from(bytes).signature!)),
  };
  const chain = new SolanaGateway(connection as unknown as Connection, payer);
  const attempt = await chain.prepare(validated);
  const transaction = Transaction.from(Buffer.from(attempt.rawTransaction, 'base64'));
  expect(transaction.verifySignatures()).toBe(true);
  expect(base58.encode(transaction.signature!)).toBe(attempt.signature);
  expect(transaction.feePayer?.equals(payer.publicKey)).toBe(true);
  expect(transaction.instructions).toHaveLength(2);
  await chain.send(attempt);
  expect(connection.sendRawTransaction).toHaveBeenCalledExactlyOnceWith(Buffer.from(attempt.rawTransaction, 'base64'), { skipPreflight: true, maxRetries: 0 });
});

test('only confirmed or finalized statuses with a real block time become decisions', async () => {
  const status = { slot: 10, confirmationStatus: 'processed', err: null };
  const connection = {
    getSignatureStatuses: vi.fn(async () => ({ value: [status] })),
    getBlockTime: vi.fn(async (): Promise<number | null> => 1800000000),
  };
  const chain = new SolanaGateway(connection as unknown as Connection, Keypair.generate());
  expect(await chain.observe('test')).toBeNull();
  expect(connection.getBlockTime).not.toHaveBeenCalled();
  status.confirmationStatus = 'confirmed';
  expect(await chain.observe('test')).toEqual({ slot: 10, blockTime: 1800000000, error: null, errorCode: 0 });
  connection.getBlockTime.mockResolvedValue(null);
  expect(await chain.observe('test')).toBeNull();
  expect(connection.getSignatureStatuses).toHaveBeenCalledWith(['test'], { searchTransactionHistory: true });
});

test('maps the redeem error namespace without mislabeling other instructions or runtime errors', () => {
  expect(decodeChainError({ InstructionError: [1, { Custom: 6011 }] })).toEqual({ error: 'SerialUsed', errorCode: 6011 });
  expect(decodeChainError({ InstructionError: [0, { Custom: 6011 }] })).toBeNull();
  expect(decodeChainError({ InstructionError: [1, { Custom: 70000 }] })).toBeNull();
  expect(decodeChainError('BlockhashNotFound')).toBeNull();
});

test('history lookup distinguishes missing signatures from found but unrepresentable results', async () => {
  const rpc = { getSignatureStatuses: vi.fn(async (): Promise<{ value: unknown[] }> => ({ value: [null] })),
    getBlockHeight: vi.fn(async () => 101) };
  const chain = new SolanaGateway(rpc as unknown as Connection, Keypair.generate());
  expect(await chain.blockHeight()).toBe(101); expect(rpc.getBlockHeight).toHaveBeenCalledExactlyOnceWith('confirmed');
  expect(await chain.lookup('original')).toEqual({ found: false, decision: null });
  expect(rpc.getSignatureStatuses).toHaveBeenCalledExactlyOnceWith(['original'], { searchTransactionHistory: true });
  rpc.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: 'confirmed', err: 'BlockhashNotFound' }] });
  expect(await chain.lookup('original')).toEqual({ found: true, decision: null });
});
