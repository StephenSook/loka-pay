import pg from 'pg';
import { Connection } from '@solana/web3.js';
import { buildApp, privateLogger } from './app/app.js';
import { loadConfig } from './app/config.js';

// Production entry point on the VPS (docs/RUNBOOK-KEYS.md). Devnet sandbox only.
const config = loadConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5 });
const connection = new Connection(config.rpcUrl, 'confirmed');
const app = await buildApp({
  database: pool, connection, pins: config.pins, wallets: config.wallets, certificateSeed: config.certificateSeed,
  teamKeys: config.teamKeys, policies: config.policies, noteFeeDailyLamports: config.noteFeeDailyLamports,
  canaryKeyHashes: config.canaryKeyHashes, commit: config.commit, origins: config.origins,
  trustProxy: config.trustProxy, logger: privateLogger(),
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => { void app.close().then(() => pool.end()).then(() => process.exit(0)); });
}
await app.listen({ host: '0.0.0.0', port: config.port });
