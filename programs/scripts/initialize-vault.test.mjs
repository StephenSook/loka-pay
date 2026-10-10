import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as anchor from '@anchor-lang/core';
import { AccountLayout, MintLayout, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import {
  MINT, PROGRAM_ID, addresses, prepareInitialization, verifyInitialization,
} from './initialize-vault.mjs';

// Offline account fixtures. No keys, validator, RPC connection or transactions are created.
const idl = JSON.parse(readFileSync(new URL('../idl/loka_vault.json', import.meta.url), 'utf8'));
const coder = new anchor.BorshAccountsCoder(idl);
const info = (owner, data, executable = false) => ({ owner, data, executable, lamports: 1, rentEpoch: 0 });
const emptyKey = SystemProgram.programId;

async function fixture({ initialized = false, decimals = 6, mint = MINT, cluster = 0, frozen = false } = {}) {
  const accounts = new Map();
  accounts.set(PROGRAM_ID.toBase58(), info(
    new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'), Buffer.alloc(0), true,
  ));
  const mintData = Buffer.alloc(MintLayout.span);
  MintLayout.encode({ mintAuthorityOption: 0, mintAuthority: emptyKey, supply: 0n,
    decimals, isInitialized: true, freezeAuthorityOption: 0, freezeAuthority: emptyKey }, mintData);
  accounts.set(MINT.toBase58(), info(TOKEN_PROGRAM_ID, mintData));
  const tokens = Buffer.alloc(AccountLayout.span);
  AccountLayout.encode({ mint: MINT, owner: addresses.vault, amount: 12n,
    delegateOption: 0, delegate: emptyKey, state: frozen ? 2 : 1,
    isNativeOption: 0, isNative: 0n, delegatedAmount: 0n,
    closeAuthorityOption: 0, closeAuthority: emptyKey }, tokens);
  // The vault ATA can already exist before initialize_vault.
  accounts.set(addresses.vaultTokens.toBase58(), info(TOKEN_PROGRAM_ID, tokens));
  if (initialized) {
    const [, configBump] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
    const [, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), MINT.toBuffer()], PROGRAM_ID);
    accounts.set(addresses.config.toBase58(), info(PROGRAM_ID,
      await coder.encode('VaultConfig', { mint, cluster, bump: configBump })));
    accounts.set(addresses.vault.toBase58(), info(PROGRAM_ID,
      await coder.encode('VaultAuthority', { bump: vaultBump })));
  }
  return {
    accounts,
    connection: {
      getAccountInfo: async key => accounts.get(key.toBase58()) ?? null,
      getMultipleAccountsInfo: async keys => keys.map(key => accounts.get(key.toBase58()) ?? null),
    },
  };
}

test('builds the IDL instruction with devnet cluster and the supplied authority signer', async () => {
  const { connection } = await fixture();
  const { instruction, existing } = await prepareInitialization(connection, emptyKey);
  assert.equal(existing, null);
  assert(instruction.programId.equals(PROGRAM_ID));
  const definition = idl.instructions.find(value => value.name === 'initialize_vault');
  assert.deepEqual([...instruction.data], [...definition.discriminator, 0]);
  assert(instruction.keys[0].pubkey.equals(emptyKey));
  assert.equal(instruction.keys[0].isSigner, true);
  assert.equal(instruction.keys.filter(key => key.isSigner).length, 1);
  assert(instruction.keys[2].pubkey.equals(addresses.programData));
  assert(instruction.keys[5].pubkey.equals(MINT));
  assert(instruction.keys[6].pubkey.equals(addresses.vaultTokens));
});

test('an initialized vault is verified without preparing another transaction', async () => {
  const { connection } = await fixture({ initialized: true });
  const prepared = await prepareInitialization(connection, emptyKey);
  assert.equal(prepared.instruction, null);
  assert.equal(prepared.existing.verified, true);
  assert.equal(prepared.existing.balanceUnits, '12');
  assert.deepEqual(await verifyInitialization(connection), prepared.existing);
});

test('verify refuses an uninitialized vault', async () => {
  const { connection } = await fixture();
  await assert.rejects(verifyInitialization(connection), /not initialized/);
});

for (const [name, options, message] of [
  ['wrong mint', { mint: emptyKey }, /different mint/],
  ['wrong cluster', { cluster: 1 }, /not configured for devnet/],
  ['frozen ATA', { frozen: true }, /unusable/],
  ['wrong decimals', { decimals: 9 }, /six decimals/],
]) {
  test(`refuses ${name} before preparing a transaction`, async () => {
    const { connection } = await fixture({ initialized: true, ...options });
    await assert.rejects(prepareInitialization(connection, emptyKey), message);
  });
}

test('refuses partial or foreign-owned state', async () => {
  const { connection, accounts } = await fixture({ initialized: true });
  const vault = accounts.get(addresses.vault.toBase58());
  accounts.delete(addresses.vault.toBase58());
  await assert.rejects(prepareInitialization(connection, emptyKey), /incomplete/);
  accounts.set(addresses.vault.toBase58(), { ...vault, owner: emptyKey });
  await assert.rejects(prepareInitialization(connection, emptyKey), /Wrong vault account owner/);
});

test('refuses a missing program before preparing a transaction', async () => {
  const { connection, accounts } = await fixture();
  accounts.delete(PROGRAM_ID.toBase58());
  await assert.rejects(prepareInitialization(connection, emptyKey), /not deployed/);
});
