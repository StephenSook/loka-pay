import { readFileSync } from 'node:fs';
import anchor from '@anchor-lang/core';
import { AccountLayout, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from '@solana/spl-token';
import { PublicKey, type Connection } from '@solana/web3.js';

const idl = JSON.parse(readFileSync(new URL('../../../programs/idl/loka_vault.json', import.meta.url), 'utf8'));
const coder = new anchor.BorshAccountsCoder(idl);
export interface ReservePins { cluster: string; programId: string; mint: string; accounts: { vault: string; vaultUsdcAccount: string } }
export async function readReserves(connection: Pick<Connection, 'getProgramAccounts' | 'getMultipleAccountsInfoAndContext'>, pins: ReservePins) {
  if (pins.cluster !== 'devnet') throw new Error('Reserves reader is devnet only');
  const program = new PublicKey(pins.programId);
  const list = async (minContextSlot?: number) => {
    const answer = await connection.getProgramAccounts(program, { commitment: 'confirmed', withContext: true,
      dataSlice: { offset: 0, length: 8 }, ...(minContextSlot === undefined ? {} : { minContextSlot }) });
    const accounts = answer.value.map(({ pubkey, account }) => {
      if (!account.owner.equals(program)) throw new Error('Wrong program account owner');
      const type = idl.accounts.find((a: { discriminator: number[] }) => Buffer.from(a.discriminator).equals(account.data));
      if (!type) throw new Error('Unknown program account, no reserves verdict');
      return { address: pubkey.toBase58(), type: type.name as string };
    }).filter(row => ['Allowance', 'Merchant'].includes(row.type)).sort((a, b) => a.address.localeCompare(b.address));
    return { slot: answer.context.slot, accounts };
  };
  let listed = await list();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (listed.accounts.length > 99) throw new Error('More than 99 liabilities cannot be read with the vault at one slot');
    const keys = [new PublicKey(pins.accounts.vaultUsdcAccount), ...listed.accounts.map(row => new PublicKey(row.address))];
    const snapshot = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed', minContextSlot: listed.slot });
    const check = await list(snapshot.context.slot);
    if (snapshot.context.slot < listed.slot || check.slot < snapshot.context.slot) throw new Error('RPC did not honor snapshot slot bounds');
    if (JSON.stringify(listed.accounts) !== JSON.stringify(check.accounts)) { listed = check; continue; }
    if (snapshot.value.length !== keys.length) throw new Error('Incomplete reserves snapshot');
    const vault = snapshot.value[0];
    if (!vault || !vault.owner.equals(TOKEN_PROGRAM_ID) || vault.data.length !== AccountLayout.span) throw new Error('Invalid vault token account');
    const token = AccountLayout.decode(vault.data);
    if (!token.mint.equals(new PublicKey(pins.mint)) || !token.owner.equals(new PublicKey(pins.accounts.vault)) || token.state !== 1) throw new Error('Vault mint, authority or state mismatch');
    const derivedVault = PublicKey.findProgramAddressSync([Buffer.from('vault'), new PublicKey(pins.mint).toBuffer()], program)[0];
    if (!derivedVault.equals(new PublicKey(pins.accounts.vault))) throw new Error('Vault authority does not match deployed PDA');
    if (!getAssociatedTokenAddressSync(new PublicKey(pins.mint), derivedVault, true).equals(new PublicKey(pins.accounts.vaultUsdcAccount))) throw new Error('Vault token address is not its canonical ATA');
    let allowanceRemaining = 0n, bonds = 0n, merchantBalances = 0n;
    const allowances: { address: string; remaining: string; bond: string }[] = [], merchants: { address: string; balance: string }[] = [];
    for (let n = 0; n < listed.accounts.length; n++) {
      const row = listed.accounts[n], account = snapshot.value[n + 1];
      if (!account || !account.owner.equals(program)) throw new Error('Liability account missing or wrong owner');
      const decoded = coder.decode(row.type, account.data);
      if (row.type === 'Allowance') {
        const id = Buffer.alloc(8); id.writeBigUInt64BE(BigInt(decoded.id.toString()));
        if (PublicKey.findProgramAddressSync([Buffer.from('allowance'), id], program)[0].toBase58() !== row.address) throw new Error('Allowance PDA mismatch');
        const remaining = BigInt(decoded.cap.toString()) - BigInt(decoded.redeemed.toString()), bond = BigInt(decoded.bond.toString());
        if (remaining < 0n) throw new Error('Negative allowance remainder');
        allowanceRemaining += remaining; bonds += bond; allowances.push({ address: row.address, remaining: remaining.toString(), bond: bond.toString() });
      } else {
        if (PublicKey.findProgramAddressSync([Buffer.from('merchant'), Buffer.from(decoded.key_hash)], program)[0].toBase58() !== row.address) throw new Error('Merchant PDA mismatch');
        const balance = BigInt(decoded.balance.toString()); merchantBalances += balance;
        merchants.push({ address: row.address, balance: balance.toString() });
      }
    }
    const assets = token.amount, liabilities = allowanceRemaining + bonds + merchantBalances;
    return { slot: snapshot.context.slot, listedAt: { first: listed.slot, check: check.slot }, source: 'devnet_accounts',
      assets: assets.toString(), allowanceRemaining: allowanceRemaining.toString(), merchantBalances: merchantBalances.toString(), bonds: bonds.toString(),
      liabilities: liabilities.toString(), difference: (assets - liabilities).toString(), solvent: assets >= liabilities,
      allowances, merchants, scope: 'Current deployed ledger only. No fee, bounty, refund or reclaim instructions are claimed.' };
  }
  throw new Error('Program accounts changed during snapshot, no reserves verdict');
}
