import { beforeAll, describe, expect, test } from 'vitest';
import { ComputeBudgetProgram, Keypair } from '@solana/web3.js';
import { createAccount, getAccount } from '@solana/spl-token';
import { fixture, open, note, precompile, redeemIx, send, refuse, withdrawal, merchantAccount,
  merchantA, impostor, type Fixture } from './helpers.js';

let f: Fixture;
beforeAll(async () => { f = await fixture(); });
describe('withdraw: PAYMENT-V1 section 4.7', () => {
  async function funded() {
    const a = await open(f); const bytes = note(f, a);
    await send(f, [precompile(bytes), await redeemIx(f, a, bytes)]);
    return a;
  }
  test('transfers only the credited amount to the signed wallet ATA and increments its counter', async () => {
    const a = await funded(); const w = await withdrawal(f);
    const balance = BigInt((await merchantAccount(f)).balance.toString());
    const assets = (await getAccount(f.provider.connection, f.vaultTokens)).amount;
    await send(f, [precompile(w.bytes, merchantA), w.ix]);
    expect((await getAccount(f.provider.connection, w.destinationTokens)).amount).toBe(w.amount);
    expect((await getAccount(f.provider.connection, f.vaultTokens)).amount).toBe(assets - w.amount);
    const after = await merchantAccount(f);
    expect(BigInt(after.balance.toString())).toBe(balance - w.amount);
    expect(BigInt(after.withdrawCounter.toString())).toBe(w.counter + 1n);
    await refuse(f, a, [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 }),
      precompile(w.bytes, merchantA), w.ix], /WithdrawalReplay/);
  });
  test('wrong signing key, missing precompile and future counter are refused', async () => {
    const a = await funded(); const w = await withdrawal(f);
    await refuse(f, a, [precompile(w.bytes, impostor), w.ix], /PayerMismatch/);
    await refuse(f, a, [w.ix], /BadPrecompile/);
    const future = await withdrawal(f, 1n, { counter: w.counter + 1n });
    await refuse(f, a, [precompile(future.bytes, merchantA), future.ix], /WithdrawalReplay/);
  });
  test('cannot overdraw or withdraw zero', async () => {
    const a = await funded(); const balance = BigInt((await merchantAccount(f)).balance.toString());
    const over = await withdrawal(f, balance + 1n);
    await refuse(f, a, [precompile(over.bytes, merchantA), over.ix], /InsufficientBalance/);
    const zero = await withdrawal(f, 0n);
    await refuse(f, a, [precompile(zero.bytes, merchantA), zero.ix], /InvalidNote/);
  });
  test('signed domain mismatches cannot transfer tokens', async () => {
    const a = await funded();
    for (const [offset, value, error] of [[0, 0, 'InvalidNote'], [16, 255, 'WrongProgram'], [48, 1, 'WrongCluster'], [49, 255, 'WrongMint']] as const) {
      const w = await withdrawal(f); w.bytes[offset] = value;
      const ix = await f.program.methods.withdraw(Array.from(w.bytes)).accountsStrict(w.accounts).instruction();
      await refuse(f, a, [precompile(w.bytes, merchantA), ix], new RegExp(error));
    }
  });
  test('substituting the signed wallet or a noncanonical token account is refused', async () => {
    const a = await funded();
    const w = await withdrawal(f, 1n, { destination: Keypair.generate().publicKey.toBytes() });
    await refuse(f, a, [precompile(w.bytes, merchantA), w.ix], /BadDestination/);
    const valid = await withdrawal(f);
    const nonAta = await createAccount(f.provider.connection, f.wallet, f.mint, valid.accounts.destination, Keypair.generate());
    const ix = await f.program.methods.withdraw(Array.from(valid.bytes)).accountsStrict({ ...valid.accounts, destinationTokens: nonAta }).instruction();
    await refuse(f, a, [precompile(valid.bytes, merchantA), ix], /ConstraintAssociated|ConstraintSeeds/);
  });
});
