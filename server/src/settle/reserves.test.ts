import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import anchor from '@anchor-lang/core';
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { Keypair, PublicKey, type Connection } from '@solana/web3.js';
import { readReserves } from './reserves.js';

async function fixture() {
  const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
  const coder = new anchor.BorshAccountsCoder(idl), program = Keypair.generate().publicKey, mint = Keypair.generate().publicKey;
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), mint.toBuffer()], program)[0];
  const tokenKey = getAssociatedTokenAddressSync(mint, vault, true), id = Buffer.alloc(8); id.writeBigUInt64BE(1n);
  const allowanceKey = PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0];
  const hash = Buffer.alloc(32, 1), merchantKey = PublicKey.findProgramAddressSync([Buffer.from('merchant'), hash], program)[0];
  const allowance = { id: new anchor.BN(1), funder: Keypair.generate().publicKey, payer_key: Array(33).fill(2),
    cap: new anchor.BN(100), redeemed: new anchor.BN(0), offline_limit: new anchor.BN(100), expiry: new anchor.BN(0), bond: new anchor.BN(10), earmarks: [], used_serials: Array(32).fill(0), bump: 1 };
  const merchant = { public_key: Array(33).fill(2), key_hash: Array.from(hash), balance: new anchor.BN(0), withdraw_counter: new anchor.BN(0), bump: 1 };
  const token = Buffer.alloc(AccountLayout.span); mint.toBuffer().copy(token); vault.toBuffer().copy(token, 32); token.writeBigUInt64LE(110n, 64); token[108] = 1;
  const info = (data: Buffer, owner = program) => ({ data, owner, executable: false, lamports: 1, rentEpoch: 1 });
  const records = new Map([[tokenKey.toBase58(), info(token, TOKEN_PROGRAM_ID)], [allowanceKey.toBase58(), info(await coder.encode('Allowance', allowance))], [merchantKey.toBase58(), info(await coder.encode('Merchant', merchant))]]);
  let slot = 10;
  const rpc = { getProgramAccounts: vi.fn(async () => ({ context: { slot: ++slot }, value: [...records].filter(([, a]) => a.owner.equals(program)).map(([key, a]) => ({ pubkey: new PublicKey(key), account: { ...a, data: a.data.subarray(0, 8) } })) })),
    getMultipleAccountsInfoAndContext: vi.fn(async (keys: PublicKey[]) => ({ context: { slot: ++slot }, value: keys.map(key => records.get(key.toBase58()) ?? null) })) };
  const pins = { cluster: 'devnet', programId: program.toBase58(), mint: mint.toBase58(), accounts: { vault: vault.toBase58(), vaultUsdcAccount: tokenKey.toBase58() } };
  return { rpc, pins, records, token, coder, allowance, merchant, allowanceKey, merchantKey };
}
test('all liabilities and assets share one slot after funding, redeem and withdraw', async () => {
  const f = await fixture(); const read = () => readReserves(f.rpc as unknown as Connection, f.pins);
  expect(await read()).toMatchObject({ assets: '110', liabilities: '110', difference: '0', bonds: '10' });
  f.allowance.redeemed = new anchor.BN(20); f.merchant.balance = new anchor.BN(20);
  f.records.get(f.allowanceKey.toBase58())!.data = await f.coder.encode('Allowance', f.allowance);
  f.records.get(f.merchantKey.toBase58())!.data = await f.coder.encode('Merchant', f.merchant);
  expect(await read()).toMatchObject({ allowanceRemaining: '80', merchantBalances: '20', difference: '0' });
  f.merchant.balance = new anchor.BN(0); f.token.writeBigUInt64LE(90n, 64);
  f.records.get(f.merchantKey.toBase58())!.data = await f.coder.encode('Merchant', f.merchant);
  const result = await read(); expect(result).toMatchObject({ assets: '90', liabilities: '90', merchantBalances: '0' });
  expect(result.listedAt.first).toBeLessThan(result.slot); expect(result.listedAt.check).toBeGreaterThan(result.slot);
  expect(f.rpc.getMultipleAccountsInfoAndContext).toHaveBeenCalledTimes(3);
});
test('wrong mint and missing accounts fail closed', async () => {
  const f = await fixture(); f.token[0] ^= 1;
  await expect(readReserves(f.rpc as unknown as Connection, f.pins)).rejects.toThrow('Vault mint');
  f.token[0] ^= 1; f.rpc.getMultipleAccountsInfoAndContext.mockImplementation(async keys => ({ context: { slot: 0 }, value: keys.map(() => null) }));
  await expect(readReserves(f.rpc as unknown as Connection, f.pins)).rejects.toThrow('slot bounds');
  const empty = { getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: 1 }, value: keys.map(() => null) }),
    getProgramAccounts: async () => ({ context: { slot: 1 }, value: [] }) };
  await expect(readReserves(empty as unknown as Connection, f.pins)).rejects.toThrow('Invalid vault');
});

test('refuses more than 99 liabilities instead of mixing slots from separate chunks', async () => {
  const f = await fixture();
  const realList = await f.rpc.getProgramAccounts();
  f.rpc.getProgramAccounts.mockResolvedValue({ context: { slot: 10 }, value: Array.from({ length: 100 }, () => realList.value[0]) });
  await expect(readReserves(f.rpc as unknown as Connection, f.pins)).rejects.toThrow('More than 99');
  expect(f.rpc.getMultipleAccountsInfoAndContext).not.toHaveBeenCalled();
});
