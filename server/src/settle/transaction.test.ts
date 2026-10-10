import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
import * as anchor from '@anchor-lang/core';
import * as P from '@lokapay/protocol';
import { ed25519 } from '@noble/curves/ed25519.js';
import { p256 } from '@noble/curves/nist.js';
import { base58 } from '@scure/base';
import { Connection, Keypair, PublicKey, SendTransactionError, Transaction } from '@solana/web3.js';
import { SettlementService } from './service.js';
import { SettlementStore } from './store.js';
import { testDatabase } from './test-database.js';
import { buildRedeemTransaction, decodeChainError, preflightProgramError, SolanaGateway } from './transaction.js';

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
  expect(redeem.programId.equals(programId)).toBe(true);
  expect(redeem.keys[0].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0])).toBe(true);
  const id = Buffer.alloc(8); id.writeBigUInt64BE(note.note.allowanceId);
  expect(redeem.keys[1].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], programId)[0])).toBe(true);
  expect(redeem.keys[2].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(note.note.payeeKeyHash)], programId)[0])).toBe(true);
  expect(redeem.keys[3].pubkey.toBase58()).toBe(P.INSTRUCTIONS_SYSVAR_ID);
  expect(redeem.keys.map(key => [key.isSigner, key.isWritable])).toEqual([[false, false], [false, true], [false, true], [false, false]]);
});

test('redeem targets the published deployment program and config account', () => {
  const pins = JSON.parse(readFileSync(new URL('../../../config/pins.json', import.meta.url), 'utf8'));
  const liveDeployment = { programId: new PublicKey(pins.programId).toBytes(), clusterId: 0,
    mint: new PublicKey(pins.mint).toBytes() };
  // Sign a note with an ephemeral local key. No transaction is signed or submitted.
  const bytes = P.encodeNote(liveDeployment, validated.note);
  const secret = randomBytes(32);
  const wire = new Uint8Array([...bytes, ...p256.sign(bytes, secret, { lowS: true }), ...p256.getPublicKey(secret)]);
  const [precompile, redeem] = buildRedeemTransaction(P.validateNoteWire(wire, liveDeployment)).instructions;
  expect(precompile.programId.toBase58()).toBe(P.SECP256R1_PROGRAM_ID);
  expect(redeem.programId.toBase58()).toBe(pins.programId);
  expect(redeem.keys[0].pubkey.toBase58()).toBe(pins.accounts.config);
});

test('signs one transaction, keeps preflight on, sets zero retries and never reads spend state', async () => {
  const payer = Keypair.generate(); // Ephemeral local signing test only.
  const connection = {
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(async (bytes: Buffer) => base58.encode(Transaction.from(bytes).signature!)),
  };
  const chain = new SolanaGateway(connection as unknown as Connection, payer);
  const quote = await chain.quoteFee(validated);
  const attempt = await chain.prepare(validated, quote);
  const transaction = Transaction.from(Buffer.from(attempt.rawTransaction, 'base64'));
  expect(transaction.verifySignatures()).toBe(true);
  expect(base58.encode(transaction.signature!)).toBe(attempt.signature);
  expect(transaction.feePayer?.equals(payer.publicKey)).toBe(true);
  expect(transaction.instructions).toHaveLength(2);
  await chain.send(attempt);
  expect(connection.sendRawTransaction).toHaveBeenCalledExactlyOnceWith(Buffer.from(attempt.rawTransaction, 'base64'), { skipPreflight: false, maxRetries: 0 });
});

test('only an explicitly selected deliberate devnet cheat skips preflight', async () => {
  const payer = Keypair.generate();
  const rpc = { sendRawTransaction: vi.fn(async () => 'saved') };
  const gateway = new SolanaGateway(rpc as unknown as Connection, payer, { deliberateCheat: true });
  await gateway.send({ signature: 'saved', rawTransaction: 'AA==', blockhash: 'unused', lastValidBlockHeight: 1 });
  expect(rpc.sendRawTransaction).toHaveBeenCalledWith(Buffer.from('AA==', 'base64'), { skipPreflight: true, maxRetries: 0 });
});

// What web3.js throws when RPC preflight refuses a transaction: it keeps the RPC message as the RPC prints it.
const preflight = (message: string) => new SendTransactionError({ action: 'simulate', signature: '', transactionMessage: message, logs: [] });
const custom = (index: number, code: number) =>
  preflight(`Transaction simulation failed: Error processing Instruction ${index}: custom program error: 0x${code.toString(16)}`);
const signatureOf = (bytes: Buffer) => base58.encode(Transaction.from(bytes).signature!);

async function signedAttempt(sendRawTransaction: (bytes: Buffer, options: { skipPreflight: boolean }) => Promise<string>,
  options: { deliberateCheat?: boolean } = {}) {
  const payer = Keypair.generate(); // Ephemeral local signing test only.
  const connection = {
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
    sendRawTransaction: vi.fn(sendRawTransaction),
  };
  const chain = new SolanaGateway(connection as unknown as Connection, payer, options);
  const attempt = await chain.prepare(validated, await chain.quoteFee(validated));
  return { connection, chain, attempt, raw: Buffer.from(attempt.rawTransaction, 'base64') };
}

test.each([['SerialUsed', 6011], ['CapExceeded', 6012], ['EarmarkDenied', 6014]] as const)(
  'a preflight refusal with loka_vault %s from redeem_note is resent once, same bytes, without preflight', async (name, code) => {
    expect(idl.errors.find((entry: { code: number }) => entry.code === code)?.name).toBe(name);
    const { connection, chain, attempt, raw } = await signedAttempt(async (bytes, options) => {
      if (!options.skipPreflight) throw custom(1, code);
      return signatureOf(bytes);
    });
    await chain.send(attempt);
    expect(connection.sendRawTransaction).toHaveBeenCalledTimes(2);
    expect(connection.sendRawTransaction).toHaveBeenNthCalledWith(1, raw, { skipPreflight: false, maxRetries: 0 });
    expect(connection.sendRawTransaction).toHaveBeenNthCalledWith(2, raw, { skipPreflight: true, maxRetries: 0 });
    expect(signatureOf(connection.sendRawTransaction.mock.calls[1][0])).toBe(attempt.signature);
  });

test.each([
  ['blockhash not found', preflight('Transaction simulation failed: Blockhash not found')],
  ['insufficient funds for the fee', preflight('Transaction simulation failed: Attempt to debit an account but found no record of a prior credit.')],
  ['an account in use', preflight('Transaction simulation failed: Account in use')],
  ['a precompile failure', custom(0, 2)],
  ['a precompile failure carrying a loka_vault number', custom(0, 6011)],
  ['an Anchor framework code outside the IDL', custom(1, 3012)],
  ['a message that only contains a program code', preflight('Transaction simulation failed: Error processing Instruction 1: custom program error: 0x177b; retry')],
  ['an RPC transport error', new Error('fetch failed')],
] as const)('a preflight failure from %s is not resent and throws as before', async (_name, error) => {
  const { connection, chain, attempt, raw } = await signedAttempt(async () => { throw error; });
  await expect(chain.send(attempt)).rejects.toBe(error);
  expect(connection.sendRawTransaction).toHaveBeenCalledExactlyOnceWith(raw, { skipPreflight: false, maxRetries: 0 });
});

test('a failed resend propagates without a third send, and the resend must return the saved signature', async () => {
  const transport = new Error('fetch failed');
  const lost = await signedAttempt(async (_bytes, options) => { throw options.skipPreflight ? transport : custom(1, 6011); });
  await expect(lost.chain.send(lost.attempt)).rejects.toBe(transport);
  expect(lost.connection.sendRawTransaction).toHaveBeenCalledTimes(2);
  const refusedTwice = await signedAttempt(async () => { throw custom(1, 6011); });
  await expect(refusedTwice.chain.send(refusedTwice.attempt)).rejects.toThrow(SendTransactionError);
  expect(refusedTwice.connection.sendRawTransaction).toHaveBeenCalledTimes(2);
  const renamed = await signedAttempt(async (_bytes, options) => { if (!options.skipPreflight) throw custom(1, 6011); return 'other'; });
  await expect(renamed.chain.send(renamed.attempt)).rejects.toThrow('RPC returned a different transaction signature');
});

test('the deliberate cheat gateway already skips preflight and never resends a failure', async () => {
  const refused = custom(1, 6011);
  const { connection, chain, attempt, raw } = await signedAttempt(async () => { throw refused; }, { deliberateCheat: true });
  await expect(chain.send(attempt)).rejects.toBe(refused);
  expect(connection.sendRawTransaction).toHaveBeenCalledExactlyOnceWith(raw, { skipPreflight: true, maxRetries: 0 });
});

test('the refusing instruction must be the redeem_note in the signed bytes, not a compute-budget or precompile one', () => {
  const transaction = buildRedeemTransaction(validated, { units: 110000, loadedBytes: 65536 });
  transaction.feePayer = Keypair.generate().publicKey; transaction.recentBlockhash = base58.encode(new Uint8Array(32).fill(7));
  const raw = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
  expect([0, 1, 2, 3].map(index => preflightProgramError(custom(index, 6012), raw))).toEqual([null, null, null, 6012]);
  expect(preflightProgramError(custom(1, 6011), Buffer.from('AA==', 'base64'))).toBeNull();
});

test('a phone cheat refused by preflight lands on chain and resolves to a signed failed SerialUsed CONF', async () => {
  const payer = Keypair.generate(); // Ephemeral local signing test only.
  const program = new PublicKey(deployment.programId);
  const coder = new anchor.BorshAccountsCoder(idl);
  const id = Buffer.alloc(8); id.writeBigUInt64BE(validated.note.allowanceId);
  const records = new Map([
    [PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0].toBase58(), { owner: program,
      data: await coder.encode('Allowance', { id: new anchor.BN(validated.note.allowanceId.toString()), funder: Keypair.generate().publicKey,
        payer_key: Array.from(validated.payerPublicKey), cap: new anchor.BN(0), redeemed: new anchor.BN(0), offline_limit: new anchor.BN(0),
        expiry: new anchor.BN(0), bond: new anchor.BN(0), earmarks: [], used_serials: Array(32).fill(255), bump: 1 }) }],
    [PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(validated.note.payeeKeyHash)], program)[0].toBase58(), { owner: program,
      data: await coder.encode('Merchant', { public_key: Array.from(P.fromHex(vectors.keys.merchantA.publicKeyHex)),
        key_hash: Array.from(validated.note.payeeKeyHash), balance: new anchor.BN(0), withdraw_counter: new anchor.BN(0), bump: 1 }) }],
  ]);
  let landed: string | null = null;
  let confirmed = false;
  const rpc = {
    getAccountInfo: vi.fn(async (key: PublicKey) => records.get(key.toBase58()) ?? null),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    // As on devnet: preflight refuses the reused serial, and without preflight the transaction lands and fails.
    sendRawTransaction: vi.fn(async (bytes: Buffer, options: { skipPreflight: boolean }) => {
      if (!options.skipPreflight) throw custom(1, 6011);
      landed = signatureOf(bytes);
      return landed;
    }),
    getSignatureStatuses: vi.fn(async ([signature]: string[]) => ({ value: [confirmed && signature === landed
      ? { slot: 77, confirmationStatus: 'confirmed', err: { InstructionError: [1, { Custom: 6011 }] } } : null] })),
    getBlockTime: vi.fn(async () => 1800000005),
    getBlockHeight: vi.fn(async () => 50),
  };
  const db = await testDatabase();
  try {
    const store = new SettlementStore(db, () => 1800000001);
    await store.migrate();
    const seed = randomBytes(32);
    const service = new SettlementService({ deployment, store, now: () => 1800000001,
      feeBudget: { feePayer: payer.publicKey.toBase58(), dailyLamports: '1000000' },
      chain: new SolanaGateway(rpc as unknown as Connection, payer), signConfirmation: fields => P.signConfWire(fields, seed) });
    const first = await service.submit({ note: P.base64urlEncode(P.fromHex(vectors.notes[0].wireHex)) });
    expect(landed).not.toBeNull();
    expect(first).toMatchObject({ statusCode: 202, body: { status: 'pending', signature: landed } });
    confirmed = true;
    const outcome = await service.get(first.body.noteId);
    if (outcome.statusCode !== 200) throw new Error('The cheat stayed pending');
    expect(outcome.body).toMatchObject({ status: 'failed', error: 'SerialUsed', errorCode: 6011, signature: landed, slot: 77,
      explorer: `https://explorer.solana.com/tx/${landed}?cluster=devnet` });
    const conf = P.verifyConfWire(P.base64urlDecode(outcome.body.conf), ed25519.getPublicKey(seed));
    expect([conf.status, conf.errorCode, base58.encode(conf.txSignature)]).toEqual([2, 6011, landed]);
    expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(2);
    // The resend used the fee reserved for this one attempt. Nothing was reserved twice.
    expect((await db.query<{ spent: string }>('SELECT spent::text AS spent FROM settlement_fee_budgets')).rows).toEqual([{ spent: '5000' }]);
  } finally { await db.close(); }
});

test('measurement budgets preserve the adjacent precompile and redeem required by deployed code', () => {
  const transaction = buildRedeemTransaction(validated, { units: 110000, loadedBytes: 65536 });
  expect(transaction.instructions.map(ix => ix.programId.toBase58())).toEqual([
    'ComputeBudget111111111111111111111111111111', 'ComputeBudget111111111111111111111111111111',
    P.SECP256R1_PROGRAM_ID, new PublicKey(deployment.programId).toBase58(),
  ]);
  expect(transaction.instructions[0].data.readUInt32LE(1)).toBe(110000);
  expect(transaction.instructions[1].data[0]).toBe(4);
  expect(transaction.instructions[1].data.readUInt32LE(1)).toBe(65536);
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
  expect(decodeChainError({ InstructionError: [0, { Custom: 6011 }] })).toEqual({ error: 'TransactionFailed', errorCode: null });
  expect(decodeChainError({ InstructionError: [1, { Custom: 70000 }] })).toEqual({ error: 'TransactionFailed', errorCode: null });
  expect(decodeChainError('BlockhashNotFound')).toEqual({ error: 'TransactionFailed', errorCode: null });
});

test('history lookup distinguishes missing signatures from found but incomplete metadata', async () => {
  const rpc = { getSignatureStatuses: vi.fn(async (): Promise<{ value: unknown[] }> => ({ value: [null] })),
    getBlockTime: vi.fn(async () => null), getBlockHeight: vi.fn(async () => 101) };
  const chain = new SolanaGateway(rpc as unknown as Connection, Keypair.generate());
  expect(await chain.blockHeight()).toBe(101); expect(rpc.getBlockHeight).toHaveBeenCalledExactlyOnceWith('confirmed');
  expect(await chain.lookup('original')).toEqual({ found: false, decision: null });
  expect(rpc.getSignatureStatuses).toHaveBeenCalledExactlyOnceWith(['original'], { searchTransactionHistory: true });
  rpc.getSignatureStatuses.mockResolvedValue({ value: [{ confirmationStatus: 'confirmed', err: 'BlockhashNotFound' }] });
  expect(await chain.lookup('original')).toEqual({ found: true, decision: null });
});

test.each([{ InstructionError: [0, { Custom: 6011 }] }, { InstructionError: [1, { Custom: 70000 }] },
  'BlockhashNotFound', { InstructionError: [1, 'InvalidArgument'] }] as const)(
  'confirmed failure %j resolves without fabricating a redeem code', async err => {
    const rpc = { getSignatureStatuses: vi.fn(async () => ({ value: [{ slot: 55, confirmationStatus: 'confirmed', err }] })),
      getBlockTime: vi.fn(async () => 1800000000) };
    const chain = new SolanaGateway(rpc as unknown as Connection, Keypair.generate());
    expect(await chain.lookup('saved')).toEqual({ found: true,
      decision: { slot: 55, blockTime: 1800000000, error: 'TransactionFailed', errorCode: null } });
  });

test('a changed fee quote is refused before invoking the local signer', async () => {
  const payer = Keypair.generate();
  const sign = vi.spyOn(Transaction.prototype, 'sign');
  const connection = {
    getFeeForMessage: vi.fn(async () => ({ value: 5000 })),
    getLatestBlockhash: vi.fn(async () => ({ blockhash: base58.encode(new Uint8Array(32).fill(7)), lastValidBlockHeight: 100 })),
  };
  const chain = new SolanaGateway(connection as unknown as Connection, payer);
  const quote = await chain.quoteFee(validated);
  expect(quote.feePayer).toBe(payer.publicKey.toBase58()); expect(quote.lamports).toBe('5000');
  await expect(chain.prepare(validated, { ...quote, message: 'changed' })).rejects.toThrow('Quoted transaction changed');
  expect(sign).not.toHaveBeenCalled(); sign.mockRestore();
});
