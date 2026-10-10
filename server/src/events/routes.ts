import type { FastifyInstance } from 'fastify';
import type { Database } from '../settle/store.js';
import type { EventFeed } from './feed.js';
import type { EventStore, PaymentEvent } from './store.js';
import { computeStats } from './stats.js';
import { RUNS } from './runs.js';

const BACKLOG = 20;
const RESUME_LIMIT = 200;
const KEEPALIVE_MS = 15_000;

export interface EventRouteOptions { database: Database; store: EventStore; feed: EventFeed; maxClients?: number }

const frame = (event: PaymentEvent) => `id: ${event.seq}\nevent: payment\ndata: ${JSON.stringify(event)}\n\n`;

export function registerEventRoutes(app: FastifyInstance, options: EventRouteOptions): void {
  const maxClients = options.maxClients ?? 500;

  app.get<{ Querystring: { run?: string; include?: string } }>('/api/stats', async (request, reply) => {
    const { run, include } = request.query;
    if (include !== undefined && include !== 'all') {
      return reply.code(400).send({ error: 'bad_query', message: 'include accepts only "all".' });
    }
    let window;
    if (run !== undefined) {
      if (!Object.hasOwn(RUNS, run)) return reply.code(404).send({ error: 'unknown_run', message: 'Unknown measurement run.' });
      const recorded = RUNS[run];
      if (!recorded) return reply.code(404).send({ error: 'run_not_recorded', message: 'This run has not been recorded yet.' });
      window = { id: run, ...recorded };
    }
    reply.header('cache-control', 'no-store');
    return computeStats(options.database, { includeAll: include === 'all', run: window });
  });

  // Server-sent events: one `payment` event per settled or failed note, with `id` = seq for Last-Event-ID resume.
  app.get<{ Querystring: { after?: string } }>('/live', async (request, reply) => {
    if (options.feed.size >= maxClients) {
      return reply.code(503).header('retry-after', '30').send({ error: 'busy', message: 'Too many live viewers. Retry shortly.' });
    }
    const resumeHeader = request.headers['last-event-id'] ?? request.query.after;
    const resume = typeof resumeHeader === 'string' && /^[0-9]{1,15}$/.test(resumeHeader) ? Number(resumeHeader) : null;

    reply.hijack();
    const raw = reply.raw;
    // Hijacked replies skip Fastify's header handling, so copy what the hooks set (CORS) onto the raw response.
    const headers: Record<string, string> = {};
    for (const [name, value] of Object.entries(reply.getHeaders())) if (value !== undefined) headers[name] = String(value);
    raw.writeHead(200, { ...headers, 'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    raw.write('retry: 3000\n\n');

    // Subscribe before reading the backlog so nothing projected in between is lost; seq orders and dedupes.
    let lastSent = resume ?? 0;
    let pending: PaymentEvent[] | null = [];
    const send = (event: PaymentEvent) => {
      if (event.seq <= lastSent || raw.destroyed) return;
      lastSent = event.seq;
      raw.write(frame(event));
    };
    const unsubscribe = options.feed.subscribe(event => { if (pending) pending.push(event); else send(event); });
    const keepalive = setInterval(() => { if (!raw.destroyed) raw.write(': keepalive\n\n'); }, KEEPALIVE_MS);
    keepalive.unref();
    request.raw.on('close', () => { clearInterval(keepalive); unsubscribe(); });

    try {
      const backlog = await options.store.since(resume ?? 0, resume === null ? BACKLOG : RESUME_LIMIT);
      for (const event of backlog) send(event);
    } catch {
      raw.write('event: error\ndata: {"error":"backlog_unavailable"}\n\n');
    }
    const queued = pending;
    pending = null;
    for (const event of queued.sort((a, b) => a.seq - b.seq)) send(event);
  });
}
