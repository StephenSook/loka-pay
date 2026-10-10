import type { FastifyInstance } from 'fastify';
import type { Connection } from '@solana/web3.js';
import { PublicKey } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import type { Database } from '../settle/store.js';
import { certificateSigner } from '../certs/signing.js';
import { RegistrationStore } from './store.js';
import { RegistrationService } from './service.js';
import { RegistrationGateway, type Wallets } from './transaction.js';
import { registerRegistrationRoutes } from './routes.js';
import type { Policy, PoolName } from './types.js';

export interface RegistrationPins {
  cluster: string; programId: string; mint: string; serverEd25519PublicKey: string | null;
  accounts: { config: string; vault: string; vaultUsdcAccount: string };
  feePayers: { demo: string; public: string }; wallets: { tableDemo: string; publicOnboarding: string };
}
export function validateRegistrationPins(pins: RegistrationPins, wallets: Wallets, seed: Uint8Array): P.Deployment {
  if (pins.cluster !== 'devnet' || !pins.serverEd25519PublicKey) throw new Error('Publish devnet certificate key in pins first');
  const publicKey = /^[0-9a-fA-F]{64}$/.test(pins.serverEd25519PublicKey)
    ? P.fromHex(pins.serverEd25519PublicKey) : base58.decode(pins.serverEd25519PublicKey);
  if (seed.length !== 32 || !P.equalBytes(ed25519.getPublicKey(seed), publicKey)) throw new Error('Certificate signer does not match pins');
  const expected = [pins.wallets.tableDemo, pins.wallets.publicOnboarding, pins.feePayers.demo, pins.feePayers.public];
  if (new Set(expected).size !== 4) throw new Error('Registration wallets must be separate');
  const actual = [wallets.team.funder, wallets.public.funder, wallets.team.feePayer, wallets.public.feePayer];
  actual.forEach((signer, i) => { if (signer.publicKey.toBase58() !== expected[i]) throw new Error('Registration signer does not match pins'); });
  const program = new PublicKey(pins.programId), mint = new PublicKey(pins.mint);
  const config = PublicKey.findProgramAddressSync([Buffer.from('config')], program)[0];
  const vault = PublicKey.findProgramAddressSync([Buffer.from('vault'), mint.toBuffer()], program)[0];
  if (config.toBase58() !== pins.accounts.config || vault.toBase58() !== pins.accounts.vault
    || getAssociatedTokenAddressSync(mint, vault, true).toBase58() !== pins.accounts.vaultUsdcAccount) throw new Error('Vault pins do not match derived addresses');
  return { programId: program.toBytes(), mint: mint.toBytes(), clusterId: 0 };
}

// Jordan supplies the existing VPS keys, published pins and explicit budget policy.
// The app must disable body/IP logging and apply its CORS and burst guards.
export async function installRegistration(options: {
  app: FastifyInstance; database: Database; connection: Connection; pins: RegistrationPins;
  wallets: Wallets; certificateSeed: Uint8Array; teamKeys: string[]; policies: Record<PoolName, Policy>;
}): Promise<RegistrationService> {
  const deployment = validateRegistrationPins(options.pins, options.wallets, options.certificateSeed);
  if (BigInt(options.policies.public.capUnits) >= BigInt(options.policies.team.capUnits)) {
    throw new Error('Public allowance cap must be smaller than the team cap');
  }
  const namespace = `${options.pins.programId}:${options.pins.mint}:devnet`;
  const store = new RegistrationStore(options.database, namespace); await store.migrate();
  const service = new RegistrationService({ store, chain: new RegistrationGateway(options.connection, deployment, options.wallets),
    signer: certificateSigner(deployment, options.certificateSeed), teamKeys: options.teamKeys, policies: options.policies });
  registerRegistrationRoutes(options.app, service); return service;
}
