import { createHmac, randomBytes } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance, type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { Connection } from '@solana/web3.js';
import type { Pool } from 'pg';
import * as P from '@lokapay/protocol';
import type { Database } from '../settle/store.js';
import { installSettlement } from '../settle/index.js';
import { installEvents } from '../events/index.js';
import { installRegistration, validateRegistrationPins, type Wallets, type Policy, type PoolName } from '../remit/index.js';
import type { ShellPins } from './config.js';
import { installPhase3, type Phase3Config } from './phase3.js';

export interface ShellOptions {
  database: Database; connection: Connection; pins: ShellPins; wallets: Wallets; certificateSeed: Uint8Array;
  teamKeys: string[]; policies: Record<PoolName, Policy>; noteFeeDailyLamports: string; commit: string; origins: string[];
  trustProxy?: string[]; logger?: FastifyServerOptions['logger'];
  /** Payer key hashes whose payments are tagged `canary` and left out of /api/stats by default. */
  canaryKeyHashes?: string[];
  /** Event projection interval for /live; tests shorten it. */
  eventIntervalMs?: number;
  /** Requests per client per minute before the burst guard answers 429. */
  burstLimit?: number;
  phase3?: Phase3Config;
}

const BURST_WINDOW_MS = 60_000;
const BURST_TABLE_MAX = 10_000;
const HEALTH_TIMEOUT_MS = 8_000;

// Privacy (PLAN.md 3.55, D16): no request logging, no IP, header or body in any log line.
// One line per response with the method, the route pattern and the status, nothing else.
export const privateLogger = (stream?: NodeJS.WritableStream): FastifyServerOptions['logger'] => ({
  level: 'info', base: null, timestamp: false, ...(stream ? { stream } : {}),
  serializers: {
    req: () => ({}), res: () => ({}),
    err: (error: { name?: string }) => ({ type: error?.name ?? 'Error', message: 'Internal error', stack: '' }),
  },
});

export async function buildApp(options: ShellOptions): Promise<FastifyInstance> {
  // Checks the signing seed and every wallet against config/pins.json before anything listens.
  // CONF, ALLOW and MERCH are all signed with this one seed, so a mismatch fails closed for all three.
  const deployment = validateRegistrationPins(options.pins, options.wallets, options.certificateSeed);
  const seed = options.certificateSeed;
  const app = Fastify({
    logger: options.logger ?? false, logController: new LogController({ disableRequestLogging: true }),
    trustProxy: options.trustProxy ?? ['127.0.0.1', '::1'],
  });

  // Burst guard keyed by an HMAC of the client address with a per-boot secret, kept in memory only.
  const bootSecret = randomBytes(32);
  const clientKey = (request: FastifyRequest) => createHmac('sha256', bootSecret).update(request.ip).digest('hex');
  const bursts = new Map<string, { count: number; expires: number }>();
  const limit = options.burstLimit ?? 120;
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && options.origins.includes(origin)) {
      reply.header('access-control-allow-origin', origin).header('vary', 'Origin')
        .header('access-control-allow-methods', 'GET, POST, OPTIONS')
        .header('access-control-allow-headers', 'Content-Type')
        // Lets /send read Retry-After on a 429 and say when to try again.
        .header('access-control-expose-headers', 'Retry-After');
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
    const now = Date.now();
    const key = clientKey(request);
    const entry = bursts.get(key);
    if (entry && entry.expires > now) {
      if (++entry.count <= limit) return;
    } else {
      if (bursts.size >= BURST_TABLE_MAX) for (const [k, v] of bursts) if (v.expires <= now) bursts.delete(k);
      if (bursts.size < BURST_TABLE_MAX) { bursts.set(key, { count: 1, expires: now + BURST_WINDOW_MS }); return; }
    }
    return reply.code(429).header('retry-after', '60')
      .send({ error: 'rate_limited', message: 'Too many requests from this network. Retry in one minute.' });
  });
  app.addHook('onResponse', async (request, reply) => {
    app.log.info({ method: request.method, route: request.routeOptions.url ?? 'unmatched', status: reply.statusCode });
  });
  app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: 'unknown_route', message: 'Unknown API route.' }));
  app.setErrorHandler(async (_error, _request, reply) =>
    reply.code(500).send({ error: 'internal_error', message: 'Internal error.' }));

  // API-V1 section 6: the slot is read live on every call; 503 with ok false when the RPC cannot be reached.
  const phase3Routes = await installPhase3({ app, database: options.database, connection: options.connection,
    pins: options.pins, deployment, certificateSeed: seed, config: options.phase3 });
  app.get('/api/health', async (_request, reply) => {
    const base = { commit: options.commit, cluster: 'devnet', programId: options.pins.programId, phase3Routes };
    try {
      const slot = await Promise.race([
        options.connection.getSlot('confirmed'),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), HEALTH_TIMEOUT_MS).unref()),
      ]);
      return { ok: true, ...base, slot };
    } catch {
      return reply.code(503).send({ ok: false, ...base, slot: null });
    }
  });

  await installRegistration({ app, database: options.database, connection: options.connection, pins: options.pins,
    wallets: options.wallets, certificateSeed: seed, teamKeys: options.teamKeys, policies: options.policies });
  // Notes are fee-paid by the demo fee payer (docs/RUNBOOK-KEYS.md). installSettlement types its
  // database as pg.Pool but only calls query(), which PGlite in tests also provides.
  await installSettlement({ app, database: options.database as unknown as Pool, connection: options.connection, deployment,
    feePayer: options.wallets.team.feePayer, feeBudget: { dailyLamports: options.noteFeeDailyLamports }, pins: options.pins, confirmationSeed: seed });
  // Task 2.10: reads the settlement journal written above.
  await installEvents({ app, database: options.database, deployment, canaryKeyHashes: options.canaryKeyHashes,
    intervalMs: options.eventIntervalMs, clientKey });
  return app;
}
