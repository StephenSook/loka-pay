import type { FastifyInstance } from 'fastify';
import type { Pool } from 'pg';
import type { Connection, Signer } from '@solana/web3.js';
import type { Deployment } from '@lokapay/protocol';
import type { ConfirmationSigner } from './types.js';
import { SettlementService } from './service.js';
import { SettlementStore } from './store.js';
import { SolanaGateway } from './transaction.js';
import { registerSettlementRoutes } from './routes.js';

// Jordan supplies pins, VPS signers, database, CORS and atomic fee-budget admission.
// Do not enable request/body/IP logging. No secrets are read or generated in this module.
// Public exposure also needs admission controls: stateless validation cannot bind a supplied
// payer key to an allowance without the on-chain check. Alternate-key failures can claim a note id.
export async function installSettlement(options: {
  app: FastifyInstance;
  database: Pool;
  connection: Connection;
  deployment: Deployment;
  feePayer: Signer;
  signConfirmation: ConfirmationSigner;
}): Promise<SettlementService> {
  const store = new SettlementStore(options.database);
  await store.migrate();
  const service = new SettlementService({ deployment: options.deployment, store,
    chain: new SolanaGateway(options.connection, options.feePayer), signConfirmation: options.signConfirmation });
  registerSettlementRoutes(options.app, service);
  return service;
}
