import { createPrivateKey } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair } from '@solana/web3.js';
import type { RegistrationPins, Wallets, Policy, PoolName } from '../remit/index.js';

// Reads the VPS keys and public pins. Private key bytes stay in memory and are never logged.
// Key files: docs/RUNBOOK-KEYS.md. Every variable here is listed in server/.env.example.
export type ShellPins = RegistrationPins & { settlementNodeFingerprint?: string | null };
export interface ShellConfig {
  port: number; databaseUrl: string; rpcUrl: string; commit: string; origins: string[];
  trustProxy: string[]; pins: ShellPins; wallets: Wallets; certificateSeed: Uint8Array;
  teamKeys: string[]; policies: Record<PoolName, Policy>;
  /** Most lamports the note fee payer spends on settlement fees per UTC day (PR #19 fee admission). */
  noteFeeDailyLamports: string;
  canaryKeyHashes: string[];
}

const DEFAULT_PINS = new URL('../../../config/pins.json', import.meta.url);

/** Raw 32-byte Ed25519 seed from the PKCS#8 PEM that task 1.0 generated on the VPS. */
export function ed25519Seed(pem: string): Uint8Array {
  const key = createPrivateKey(pem);
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('Server signing key is not Ed25519');
  const d = key.export({ format: 'jwk' }).d;
  if (!d) throw new Error('Server signing key has no private part');
  return new Uint8Array(Buffer.from(d, 'base64url'));
}

export function solanaKeypair(path: string): Keypair {
  const bytes = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every(b => Number.isInteger(b) && b >= 0 && b <= 255)) {
    throw new Error(`Not a Solana keypair file: ${path}`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function units(env: NodeJS.ProcessEnv, name: string, fallback: string): string {
  const value = env[name] ?? fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error(`${name} must be a whole number`);
  return value;
}

/** Allowance terms per pool. Amounts are USDC base units; lamport budgets cap what each funder and fee payer spends per day. */
export function policiesFrom(env: NodeJS.ProcessEnv): Record<PoolName, Policy> {
  return {
    team: {
      capUnits: '5000000', offlineLimitUnits: '2000000', bondUnits: '0', lifetimeSeconds: 86400, earmarks: [],
      daily: { units: units(env, 'TEAM_DAILY_BUDGET_UNITS', '10000000'),
        funderLamports: units(env, 'TEAM_DAILY_FUNDER_LAMPORTS', '80000000'),
        feeLamports: units(env, 'TEAM_DAILY_FEE_LAMPORTS', '100000000') },
    },
    public: {
      capUnits: '1000000', offlineLimitUnits: '1000000', bondUnits: '0', lifetimeSeconds: 86400, earmarks: [],
      daily: { units: units(env, 'PUBLIC_DAILY_BUDGET_UNITS', '10000000'),
        funderLamports: units(env, 'PUBLIC_DAILY_FUNDER_LAMPORTS', '80000000'),
        feeLamports: units(env, 'PUBLIC_DAILY_FEE_LAMPORTS', '100000000') },
    },
  };
}

const list = (value: string | undefined, fallback: string) => (value ?? fallback).split(',').map(s => s.trim()).filter(Boolean);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ShellConfig {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const keys = env.KEYS_DIR ?? '/run/keys';
  const pins = JSON.parse(readFileSync(env.PINS_PATH ?? DEFAULT_PINS, 'utf8')) as ShellPins;
  const wallet = (name: string) => solanaKeypair(join(keys, `${name}.json`));
  const port = Number(env.PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a TCP port');
  return {
    port, databaseUrl, pins,
    rpcUrl: env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    commit: env.COMMIT_SHA || 'uncommitted',
    origins: list(env.CORS_ORIGINS, 'https://zerobars.us,https://www.zerobars.us'),
    // Caddy on the host reaches the container through the Docker bridge, so its address is trusted for X-Forwarded-For.
    trustProxy: list(env.TRUST_PROXY, '127.0.0.1,::1,172.16.0.0/12'),
    wallets: {
      team: { funder: wallet('funding-table-demo'), feePayer: wallet('fee-payer-demo') },
      public: { funder: wallet('funding-public-onboarding'), feePayer: wallet('fee-payer-public') },
    },
    certificateSeed: ed25519Seed(readFileSync(join(keys, 'server-ed25519.pem'), 'utf8')),
    teamKeys: list(env.TEAM_KEY_HASHES, ''),
    policies: policiesFrom(env),
    noteFeeDailyLamports: units(env, 'NOTE_DAILY_FEE_LAMPORTS', '200000000'),
    canaryKeyHashes: list(env.CANARY_KEY_HASHES, ''),
  };
}
