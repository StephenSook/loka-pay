import type { FastifyInstance } from 'fastify';
import type * as P from '@lokapay/protocol';
import type { Database } from '../settle/store.js';
import { EventFeed } from './feed.js';
import { EventStore, type Source } from './store.js';
import { registerEventRoutes } from './routes.js';

export { EventStore, SOURCES, EXCLUDED_BY_DEFAULT, type PaymentEvent, type Source } from './store.js';
export { EventFeed } from './feed.js';
export { computeStats, sandboxUsd, type Stats, type Figures } from './stats.js';

/**
 * Task 2.10: events store, GET /api/stats and SSE GET /live. Install after installSettlement, whose
 * settlement_attempts table this module reads. Payments from a canary payer key are tagged `canary`;
 * every other direct upload is `phone_ble` until the gateway and SMS rails tag their own.
 */
export async function installEvents(options: {
  app: FastifyInstance; database: Database; deployment: P.Deployment; canaryKeyHashes?: string[];
  intervalMs?: number; maxClients?: number;
}): Promise<{ store: EventStore; feed: EventFeed }> {
  const canary = new Set(options.canaryKeyHashes ?? []);
  for (const hash of canary) if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('Invalid canary key hash');
  const sourceOf = (payerKeyHash: string): Source => (canary.has(payerKeyHash) ? 'canary' : 'phone_ble');
  const store = new EventStore(options.database, options.deployment, sourceOf);
  await store.migrate();
  const feed = new EventFeed(store, options.intervalMs);
  feed.start(() => options.app.log.error({ module: 'events' }, 'event projection failed'));
  options.app.addHook('onClose', async () => feed.stop());
  registerEventRoutes(options.app, { database: options.database, store, feed, maxClients: options.maxClients });
  return { store, feed };
}
