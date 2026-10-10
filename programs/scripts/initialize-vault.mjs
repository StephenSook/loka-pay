import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as anchor from '@anchor-lang/core';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync,
  getMint, unpackAccount,
} from '@solana/spl-token';
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction,
} from '@solana/web3.js';

// Sandbox only. No key generation, airdrops, minting or deployment.
export const RPC_URL = 'https://api.devnet.solana.com';
export const PROGRAM_ID = new PublicKey('HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG');
export const MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const idl = JSON.parse(readFileSync(new URL('../idl/loka_vault.json', import.meta.url), 'utf8'));
assert.equal(idl.address, PROGRAM_ID.toBase58(), 'IDL program id differs from the reviewed deployment');
const coder = new anchor.BorshAccountsCoder(idl);
const [config, configBump] = PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
const [vault, vaultBump] = PublicKey.findProgramAddressSync([Buffer.from('vault'), MINT.toBuffer()], PROGRAM_ID);
const [programData] = PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], LOADER);
const vaultTokens = getAssociatedTokenAddressSync(MINT, vault, true);
export const addresses = { config, vault, vaultTokens, programData };

async function assertDeployment(connection) {
  const deployed = await connection.getAccountInfo(PROGRAM_ID, 'confirmed');
  assert(deployed?.executable && deployed.owner.equals(LOADER), 'Program is not deployed under the upgradeable loader');
  const mint = await getMint(connection, MINT, 'confirmed', TOKEN_PROGRAM_ID);
  assert(mint.isInitialized && mint.decimals === 6, 'Mint must be initialized with six decimals');
}

export async function readVaultState(connection) {
  const [configInfo, vaultInfo, tokenInfo] = await connection.getMultipleAccountsInfo(
    [config, vault, vaultTokens], 'confirmed',
  );
  // A precreated canonical ATA is allowed, but partial program state is not.
  if (!configInfo && !vaultInfo) return null;
  assert(configInfo && vaultInfo && tokenInfo, 'Vault state is incomplete');
  assert(configInfo.owner.equals(PROGRAM_ID) && vaultInfo.owner.equals(PROGRAM_ID), 'Wrong vault account owner');
  const configuration = coder.decode('VaultConfig', configInfo.data);
  const authority = coder.decode('VaultAuthority', vaultInfo.data);
  assert(configuration.mint.equals(MINT), 'Existing vault uses a different mint');
  assert.equal(configuration.cluster, 0, 'Existing vault is not configured for devnet');
  assert.equal(configuration.bump, configBump, 'Wrong config bump');
  assert.equal(authority.bump, vaultBump, 'Wrong vault bump');
  const tokens = unpackAccount(vaultTokens, tokenInfo, TOKEN_PROGRAM_ID);
  assert(tokens.mint.equals(MINT) && tokens.owner.equals(vault), 'Wrong vault token mint or authority');
  assert(tokens.isInitialized && !tokens.isFrozen && !tokens.isNative, 'Vault token account is unusable');
  assert(tokens.delegate === null && tokens.closeAuthority === null, 'Unexpected token delegate or close authority');
  return {
    verified: true, clusterId: 0, programId: PROGRAM_ID.toBase58(), mint: MINT.toBase58(),
    config: config.toBase58(), vault: vault.toBase58(), vaultTokens: vaultTokens.toBase58(),
    balanceUnits: tokens.amount.toString(),
  };
}

export async function prepareInitialization(connection, authority) {
  await assertDeployment(connection);
  const existing = await readVaultState(connection);
  if (existing) return { existing, instruction: null };
  const program = new anchor.Program(idl, { connection });
  const instruction = await program.methods.initializeVault(0).accountsStrict({
    authority, program: PROGRAM_ID, programData, config, vault, mint: MINT, vaultTokens,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  }).instruction();
  return { existing: null, instruction };
}

export async function verifyInitialization(connection) {
  await assertDeployment(connection);
  const state = await readVaultState(connection);
  assert(state, 'Vault is not initialized');
  return state;
}

async function main() {
  const { values } = parseArgs({ options: {
    authority: { type: 'string' }, verify: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('node scripts/initialize-vault.mjs --authority <existing-upgrade-authority-keypair>');
    console.log('node scripts/initialize-vault.mjs --verify');
    return;
  }
  const connection = new Connection(RPC_URL, 'confirmed');
  if (values.verify) {
    console.log(JSON.stringify(await verifyInitialization(connection), null, 2));
    return;
  }
  assert(values.authority, 'Supply --authority with your existing upgrade-authority keypair path');
  const bytes = JSON.parse(readFileSync(values.authority, 'utf8'));
  assert(Array.isArray(bytes) && bytes.length === 64
    && bytes.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Invalid keypair file');
  const authority = Keypair.fromSecretKey(Uint8Array.from(bytes));
  const prepared = await prepareInitialization(connection, authority.publicKey);
  if (prepared.existing) {
    console.log(JSON.stringify({ alreadyInitialized: true, ...prepared.existing }, null, 2));
    return;
  }
  // The program checks this signer against ProgramData's current upgrade authority.
  const transaction = new Transaction().add(prepared.instruction);
  transaction.feePayer = authority.publicKey;
  const signature = await sendAndConfirmTransaction(connection, transaction, [authority], {
    commitment: 'confirmed', preflightCommitment: 'confirmed', skipPreflight: false,
  });
  console.log(JSON.stringify({ signature, explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet` }));
  console.log(JSON.stringify(await verifyInitialization(connection), null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message);
    console.error('Run --verify to inspect state before retrying after an uncertain RPC result.');
    process.exitCode = 1;
  });
}
