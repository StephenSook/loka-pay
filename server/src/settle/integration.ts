import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Connection, Signer } from '@solana/web3.js';
import type { Deployment } from '@lokapay/protocol';
import type { ConfirmationSigner } from './types.js';
import { SettlementService } from './service.js';
import { SettlementStore } from './store.js';
import { SolanaGateway } from './transaction.js';
import { registerSettlementRoutes } from './routes.js';
import type { FeeBudget } from './fee-budget.js';
import type { AllowanceRateLimit } from './rate-limit.js';

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
  signConfirmation: ConfirmationSigner;
  allowanceRateLimit?: AllowanceRateLimit;
}): Promise<SettlementService> {
  const store = new SettlementStore(options.database);
  await store.migrate();
  const service = new SettlementService({ feeBudget: { ...options.feeBudget, feePayer: options.feePayer.publicKey.toBase58() }, deployment: options.deployment, store,
    chain: new SolanaGateway(options.connection, options.feePayer), signConfirmation: options.signConfirmation,
    allowanceRateLimit: options.allowanceRateLimit });
  registerSettlementRoutes(options.app, service);
  return service;
}
