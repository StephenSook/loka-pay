import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Connection, Signer } from '@solana/web3.js';
import type { Deployment } from '@lokapay/protocol';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';
import * as P from '@lokapay/protocol';
import { SettlementService } from './service.js';
import { SettlementStore } from './store.js';
import { SolanaGateway } from './transaction.js';
import { registerSettlementRoutes } from './routes.js';
import type { FeeBudget } from './fee-budget.js';
import type { AllowanceRateLimit } from './rate-limit.js';

export function validateConfirmationPin(pins: { serverEd25519PublicKey: string | null }, seed: Uint8Array): void {
  if (!pins.serverEd25519PublicKey) throw new Error('Publish the CONF signing key in pins first');
  const key = /^[0-9a-fA-F]{64}$/.test(pins.serverEd25519PublicKey)
    ? P.fromHex(pins.serverEd25519PublicKey) : base58.decode(pins.serverEd25519PublicKey);
  if (seed.length !== 32 || key.length !== 32 || !P.equalBytes(ed25519.getPublicKey(seed), key)) {
    throw new Error('CONF signer does not match pins');
  }
}

// Jordan supplies pins, VPS signers, database, CORS and daily fee-budget configuration.
// Do not enable request/body/IP logging. No secrets are read or generated in this module.
// Allowance and merchant identity are checked before a note id is claimed. Spend state stays on chain.
export async function installSettlement(options: {
  app: FastifyInstance;
  database: Pool;
  connection: Connection;
  deployment: Deployment;
  feePayer: Signer;
  feeBudget: Omit<FeeBudget, 'feePayer'>;
  pins: { serverEd25519PublicKey: string | null };
  confirmationSeed: Uint8Array;
  allowanceRateLimit?: AllowanceRateLimit;
}): Promise<SettlementService> {
  const seed = Uint8Array.from(options.confirmationSeed);
  validateConfirmationPin(options.pins, seed);
  const store = new SettlementStore(options.database);
  await store.migrate();
  const service = new SettlementService({ feeBudget: { ...options.feeBudget, feePayer: options.feePayer.publicKey.toBase58() }, deployment: options.deployment, store,
    chain: new SolanaGateway(options.connection, options.feePayer), signConfirmation: fields => P.signConfWire(fields, seed),
    allowanceRateLimit: options.allowanceRateLimit });
  registerSettlementRoutes(options.app, service);
  return service;
}
