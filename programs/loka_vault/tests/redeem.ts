import { beforeAll, describe, expect, test } from 'vitest';
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionInstruction } from '@solana/web3.js';
import { createAccount, createMint, getAccount, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';
import { p256 } from '@noble/curves/nist.js';
import * as P from '@lokapay/protocol';
import { fixture, open, note, precompile, redeemIx, send, refuse, allowanceAccount, merchantAccount,
  payer, merchantA, merchantB, impostor, bn, hash, type Fixture } from './helpers.js';

let f: Fixture;
beforeAll(async () => { f = await fixture(); });
describe('redeem_note: PAYMENT-V1 sections 7 and 8', () => {
  test('funds cap plus bond, redeems and emits the signed note identity', async () => {
    const assetsBefore = (await getAccount(f.provider.connection, f.vaultTokens)).amount;
    const a = await open(f);
    expect((await getAccount(f.provider.connection, f.vaultTokens)).amount - assetsBefore).toBe(1_100_000n);
    const balance = BigInt((await merchantAccount(f)).balance.toString());
    const bytes = note(f, a);
    const signature = await send(f, [precompile(bytes), await redeemIx(f, a, bytes)]);
    expect((await allowanceAccount(f, a)).redeemed.toString()).toBe('100000');
    expect((await allowanceAccount(f, a)).usedSerials[0]).toBe(1);
    expect(BigInt((await merchantAccount(f)).balance.toString()) - balance).toBe(100_000n);
    const tx = await f.provider.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const { EventParser } = await import('@anchor-lang/core');
    const events = [...new EventParser(f.program.programId, f.program.coder).parseLogs(tx?.meta?.logMessages ?? [])];
    expect(events.some(e => e.name === 'noteRedeemed' && Buffer.from(e.data.noteId as number[]).equals(hash(bytes)))).toBe(true);
  });
  test('a reused serial and identical resubmission cannot credit again', async () => {
    const a = await open(f); const bytes = note(f, a);
    await send(f, [precompile(bytes), await redeemIx(f, a, bytes)]);
    // A distinct transaction signature forces execution instead of RPC deduplication.
    await refuse(f, a, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      precompile(bytes), await redeemIx(f, a, bytes)], /SerialUsed/);
    const conflict = note(f, a, { payeeKeyHash: merchantB.keyHash });
    await refuse(f, a, [precompile(conflict), await redeemIx(f, a, conflict, { merchant: f.merchantB })], /SerialUsed/);
  });
  test('high-S reaches the validator and is refused by the native verifier', async () => {
    const a = await open(f); const bytes = note(f, a); const pre = precompile(bytes);
    const s = BigInt('0x' + pre.data.subarray(81, 113).toString('hex'));
    const order = p256.Point.Fn.ORDER;
    Buffer.from((order - s).toString(16).padStart(64, '0'), 'hex').copy(pre.data, 81);
    // Instruction zero is the native verifier, before loka_vault can execute.
    await refuse(f, a, [pre, await redeemIx(f, a, bytes)], /Instruction 0: custom program error: 0x2/);
  });
  test('wrong-message: a valid signature over different bytes is insufficient', async () => {
    const a = await open(f);
    await refuse(f, a, [precompile(note(f, a, { amount: 1n })), await redeemIx(f, a, note(f, a))], /WrongMessage/);
  });
  test('a different valid payer signature cannot spend this allowance', async () => {
    const a = await open(f); const bytes = note(f, a);
    await refuse(f, a, [precompile(bytes, impostor), await redeemIx(f, a, bytes)], /PayerMismatch/);
  });
  for (const [name, offset, replacement, error] of [
    ['prefix', 0, 0, 'InvalidNote'], ['currency', 129, 69, 'InvalidNote'],
    ['wrong-program', 16, 255, 'WrongProgram'], ['wrong-cluster', 48, 1, 'WrongCluster'],
    ['wrong-mint', 49, 255, 'WrongMint'],
  ] as const) {
    test(`correctly signed ${name} is refused on chain`, async () => {
      const a = await open(f); const bytes = note(f, a); bytes[offset] = replacement;
      await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes)], new RegExp(error));
    });
  }
  test('correctly signed zero amount is refused', async () => {
    const a = await open(f); const bytes = note(f, a, { amount: 0n });
    await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes)], /InvalidNote/);
  });
  test('substituted-merchant and substituted-allowance accounts are refused', async () => {
    const a = await open(f); const b = await open(f); const bytes = note(f, a);
    await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes, { merchant: f.merchantB })], /InvalidMerchant/);
    await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes, { allowance: b.address })], /InvalidAllowance/);
  });
  test('substituted instructions sysvar is refused', async () => {
    const a = await open(f); const bytes = note(f, a);
    await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes, { instructions: f.config })], /BadSysvar/);
  });
  test('missing or non-adjacent precompile is refused', async () => {
    const a = await open(f); const bytes = note(f, a); const redeem = await redeemIx(f, a, bytes);
    await refuse(f, a, [redeem], /BadPrecompile/);
    await refuse(f, a, [precompile(bytes), ComputeBudgetProgram.setComputeUnitLimit({ units: 200000 }), redeem], /BadPrecompile/);
  });
  test('a valid two-signature precompile is refused by the single-note instruction', async () => {
    const a = await open(f); const bytes = note(f, a);
    const entry = { publicKey: payer.publicKey, signature: p256.sign(bytes, payer.secret), message: bytes };
    const pre = new TransactionInstruction({ programId: new PublicKey(P.SECP256R1_PROGRAM_ID), keys: [], data: Buffer.from(P.secp256r1InstructionData([entry, entry])) });
    await refuse(f, a, [pre, await redeemIx(f, a, bytes)], /BadPrecompile/);
  });
  for (const offset of [4, 8, 14]) {
    test(`a cross-instruction reference at header offset ${offset} is refused`, async () => {
      const a = await open(f); const bytes = note(f, a); const pre = precompile(bytes);
      // Index zero is this precompile too, so crypto remains valid; only the canonical rule fails.
      pre.data.writeUInt16LE(0, offset);
      await refuse(f, a, [pre, await redeemIx(f, a, bytes)], /BadPrecompile/);
    });
  }
  test('trailing precompile bytes are refused even with a valid signature', async () => {
    const a = await open(f); const bytes = note(f, a); const pre = precompile(bytes);
    pre.data = Buffer.concat([pre.data, Buffer.from([0])]);
    await refuse(f, a, [pre, await redeemIx(f, a, bytes)], /BadPrecompile/);
  });
  test('serial bits 0, 7, 8 and 255 remain independent', async () => {
    const a = await open(f);
    for (const serial of [0, 7, 8, 255]) {
      const bytes = note(f, a, { serial, amount: 1n });
      await send(f, [precompile(bytes), await redeemIx(f, a, bytes)]);
    }
    const bits = (await allowanceAccount(f, a)).usedSerials;
    expect([bits[0], bits[1], bits[31]]).toEqual([129, 1, 128]);
  });
  test('cap is cumulative, exact-cap succeeds, and a refused note does not consume its serial', async () => {
    const a = await open(f, { cap: bn(100), offlineLimit: bn(1) });
    const tooLarge = note(f, a, { amount: 101n });
    await refuse(f, a, [precompile(tooLarge), await redeemIx(f, a, tooLarge)], /CapExceeded/);
    const exact = note(f, a, { amount: 100n });
    await send(f, [precompile(exact), await redeemIx(f, a, exact)]);
    const extra = note(f, a, { amount: 1n, serial: 1 });
    await refuse(f, a, [precompile(extra), await redeemIx(f, a, extra)], /CapExceeded/);
  });
  test('expired note and note outliving its allowance are refused', async () => {
    const a = await open(f);
    for (const expiry of [1n, a.expiry + 1n]) {
      const bytes = note(f, a, { expiry });
      await refuse(f, a, [precompile(bytes), await redeemIx(f, a, bytes)], /Expired/);
    }
  });
  test('nonempty earmarks are enforced; empty earmarks permit either merchant', async () => {
    const a = await open(f, { earmarks: [Array.from(merchantB.keyHash)] });
    const denied = note(f, a);
    await refuse(f, a, [precompile(denied), await redeemIx(f, a, denied)], /EarmarkDenied/);
    const allowed = note(f, a, { payeeKeyHash: merchantB.keyHash });
    await send(f, [precompile(allowed), await redeemIx(f, a, allowed, { merchant: f.merchantB })]);
    const b = await open(f); const unrestricted = note(f, b, { payeeKeyHash: merchantB.keyHash });
    await send(f, [precompile(unrestricted), await redeemIx(f, b, unrestricted, { merchant: f.merchantB })]);
  });
  test('opening rejects overflow, expired allowances and duplicate earmarks', async () => {
    await expect(open(f, { cap: bn(2n ** 64n - 1n), bond: bn(1) })).rejects.toThrow(/Overflow/);
    await expect(open(f, { expiry: bn(1) })).rejects.toThrow(/Expired/);
    await expect(open(f, { earmarks: [Array.from(merchantA.keyHash), Array.from(merchantA.keyHash)] })).rejects.toThrow(/InvalidEarmarks/);
  });
  test('opening cannot substitute the mint, source mint or vault token account', async () => {
    const vaultBefore = (await getAccount(f.provider.connection, f.vaultTokens)).amount;
    const sourceBefore = (await getAccount(f.provider.connection, f.source)).amount;
    const otherMint = await createMint(f.provider.connection, f.wallet, f.wallet.publicKey, null, 6);
    const otherSource = (await getOrCreateAssociatedTokenAccount(f.provider.connection, f.wallet, otherMint, f.wallet.publicKey)).address;
    await expect(open(f, {}, { mint: otherMint })).rejects.toThrow(/WrongMint/);
    await expect(open(f, {}, { source: otherSource })).rejects.toThrow(/ConstraintTokenMint/);
    const noncanonicalVault = await createAccount(f.provider.connection, f.wallet, f.mint, f.vault, Keypair.generate());
    await expect(open(f, {}, { vaultTokens: noncanonicalVault })).rejects.toThrow(/ConstraintAssociated|ConstraintSeeds/);
    expect((await getAccount(f.provider.connection, noncanonicalVault)).amount).toBe(0n);
    expect((await getAccount(f.provider.connection, f.vaultTokens)).amount).toBe(vaultBefore);
    expect((await getAccount(f.provider.connection, f.source)).amount).toBe(sourceBefore);
  });
  test('an allowance id cannot be reopened to erase its used serials', async () => {
    const a = await open(f); const bytes = note(f, a);
    await send(f, [precompile(bytes), await redeemIx(f, a, bytes)]);
    await expect(open(f, { allowanceId: bn(a.id) })).rejects.toThrow();
    expect((await allowanceAccount(f, a)).usedSerials[0]).toBe(1);
  });
  test('a later failure rolls back an earlier credit in the same transaction', async () => {
    const a = await open(f); const first = note(f, a, { amount: 1n });
    const second = note(f, a, { amount: a.cap, serial: 1 });
    await refuse(f, a, [precompile(first), await redeemIx(f, a, first),
      precompile(second), await redeemIx(f, a, second)], /CapExceeded/);
  });
});
