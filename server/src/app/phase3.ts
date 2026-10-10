import type { FastifyInstance } from 'fastify';
import type { Connection, Signer } from '@solana/web3.js';
import type * as P from '@lokapay/protocol';
import { installRemittance } from '../remit/remittance-integration.js';
import type { Policy } from '../remit/types.js';
import type { Database } from '../settle/store.js';
import { readReserves } from '../settle/reserves.js';
import { registerTrustRoutes } from '../trust/index.js';
import { registerVolumeRoutes } from '../volume/index.js';
import { solanaKeypair, type ShellPins } from './config.js';

const routes = ['/api/volume', '/trust', '/v1/remittances', '/api/reserves'] as const;
type Route = typeof routes[number];
type Reason = 'missing_config' | 'invalid_config' | 'initialization_failed';
export type Phase3Status = Record<Route, { registered: boolean; reason: Reason | null }>;
export interface Phase3Config {
  volume?: Omit<Parameters<typeof registerVolumeRoutes>[1], 'programId'>;
  trust?: boolean; reserves?: boolean;
  remittance?: { wallet: Signer; policy: Policy };
  issues?: Partial<Record<Route, Reason>>;
}

export function phase3From(env: NodeJS.ProcessEnv, keypair = solanaKeypair): Phase3Config {
  const config: Phase3Config = { issues: {} };
  const flag = (name: string, route: Route): boolean => {
    if (!env[name]) return false;
    if (env[name] === 'true') return true;
    if (env[name] !== 'false') config.issues![route] = 'invalid_config';
    return false;
  };
  config.trust = flag('TRUST_ENABLED', '/trust');
  config.reserves = flag('RESERVES_ENABLED', '/api/reserves');
  if (env.VOLUME_MEASUREMENT_PATH) {
    const units = env.VOLUME_BLOCK_COMPUTE_UNITS, source = env.VOLUME_BLOCK_LIMIT_SOURCE;
    if ((units || source) && (!units || !/^[1-9][0-9]*$/.test(units) || !Number.isSafeInteger(Number(units)) || !source)) {
      config.issues!['/api/volume'] = 'invalid_config';
    } else config.volume = { measurementPath: env.VOLUME_MEASUREMENT_PATH, benchmarkPath: env.VOLUME_BENCHMARK_PATH,
      ...(units && source ? { capacity: { blockComputeUnits: Number(units), source } } : {}) };
  }
  const names = ['REMIT_SEND_KEYPAIR_PATH', 'REMIT_CAP_UNITS', 'REMIT_LIFETIME_SECONDS', 'REMIT_EARMARKS',
    'REMIT_DAILY_UNITS', 'REMIT_DAILY_FUNDER_LAMPORTS', 'REMIT_DAILY_FEE_LAMPORTS'] as const;
  if (names.every(name => Boolean(env[name]))) {
    try {
      const cap = env.REMIT_CAP_UNITS!, lifetime = Number(env.REMIT_LIFETIME_SECONDS);
      const daily = { units: env.REMIT_DAILY_UNITS!, funderLamports: env.REMIT_DAILY_FUNDER_LAMPORTS!, feeLamports: env.REMIT_DAILY_FEE_LAMPORTS! };
      const earmarks = env.REMIT_EARMARKS!.split(',').map(value => value.trim());
      if (!/^[1-9][0-9]*$/.test(cap) || BigInt(cap) > 1000000n || !Number.isSafeInteger(lifetime) || lifetime <= 0
        || Object.values(daily).some(value => !/^(0|[1-9][0-9]*)$/.test(value) || BigInt(value) >= 1n << 64n)
        || !earmarks.length || earmarks.length > 16 || earmarks.some((value, n) => !/^[a-f0-9]{64}$/.test(value) || (n > 0 && earmarks[n - 1] >= value))) throw new Error('Invalid send configuration');
      config.remittance = { wallet: keypair(env.REMIT_SEND_KEYPAIR_PATH!),
        policy: { capUnits: cap, offlineLimitUnits: cap, bondUnits: '0', lifetimeSeconds: lifetime, earmarks, daily } };
    } catch { config.issues!['/v1/remittances'] = 'invalid_config'; }
  }
  return config;
}

export async function installPhase3(options: { app: FastifyInstance; database: Database; connection: Connection;
  pins: ShellPins; deployment: P.Deployment; certificateSeed: Uint8Array; config?: Phase3Config }): Promise<Phase3Status> {
  const { app, connection, pins, config = {} } = options;
  const status = Object.fromEntries(routes.map(route => [route, { registered: false,
    reason: config.issues?.[route] ?? 'missing_config' }])) as Phase3Status;
  const install = async (route: Route, enabled: boolean, run: () => void | Promise<unknown>) => {
    if (!enabled || config.issues?.[route]) return;
    try { await run(); status[route] = { registered: true, reason: null }; }
    catch { status[route] = { registered: false, reason: 'initialization_failed' }; }
  };
  await install('/api/volume', Boolean(config.volume), () => registerVolumeRoutes(app, { ...config.volume!, programId: pins.programId }));
  await install('/trust', Boolean(config.trust && pins.upgradeAuthority !== undefined), () =>
    registerTrustRoutes(app, connection, { ...pins, upgradeAuthority: pins.upgradeAuthority! }));
  await install('/api/reserves', Boolean(config.reserves && pins.accounts?.vault && pins.accounts?.vaultUsdcAccount), () => {
    app.get('/api/reserves', async (_request, reply) => {
      try { return await readReserves(connection, pins); }
      catch { return reply.code(503).send({ error: 'reserves_unavailable', message: 'No verified reserves snapshot is available.' }); }
    });
  });
  await install('/v1/remittances', Boolean(config.remittance && pins.wallets.send), () => installRemittance({ ...options,
    pins: { ...pins, wallets: { ...pins.wallets, send: pins.wallets.send! } }, ...config.remittance! }));
  return status;
}
