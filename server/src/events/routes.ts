import type { ServerResponse } from 'node:http';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Database } from '../settle/store.js';
import type { EventFeed } from './feed.js';
import type { EventStore, PaymentEvent } from './store.js';
import { computeStats } from './stats.js';
import { RUNS } from './runs.js';
import { computeWiring } from './wiring.js';

const BACKLOG = 20;
const RESUME_PAGE = 200;
/** A viewer more than this many events behind gets a `reset` event and continues from now. */
const RESUME_MAX = 1000;
const KEEPALIVE_MS = 15_000;
/** Bytes queued for one viewer before it is disconnected; 256 KiB is several hundred events. */
const MAX_BUFFERED_BYTES = 256 * 1024;
/** How long a backlog replay waits for a viewer's socket to drain before dropping it. */
const DRAIN_TIMEOUT_MS = 10_000;

export interface EventRouteOptions {
  database: Database; store: EventStore; feed: EventFeed; maxClients?: number; maxBufferedBytes?: number;
  clientKey: (request: FastifyRequest) => string; maxStreamsPerClient?: number;
  /** The deployed commit, reported by /api/wiring next to the rows. */
  commit?: string;
}

/**
 * Writes one SSE chunk, then drops a viewer whose queued bytes pass `maxBuffered` rather than buffering without
 * bound; EventSource reconnects and resumes from its Last-Event-ID. Returns false once the stream is gone.
 */
export function writeCapped(raw: Pick<ServerResponse, 'destroyed' | 'write' | 'writableLength' | 'destroy'>,
  text: string, maxBuffered: number): boolean {
  if (raw.destroyed) return false;
  raw.write(text);
  if (raw.writableLength <= maxBuffered) return true;
  raw.destroy();
  return false;
}

const frame = (event: PaymentEvent) => `id: ${event.seq}\nevent: payment\ndata: ${JSON.stringify(event)}\n\n`;

export function registerEventRoutes(app: FastifyInstance, options: EventRouteOptions): void {
  const maxClients = options.maxClients ?? 500;
  const maxBuffered = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
  // One client holding streams open must not fill every slot (the judge desk shares the global cap).
  const perClient = options.maxStreamsPerClient ?? 3;
  const streams = new Map<string, number>();
  // Open streams are ended before Fastify waits for connections to drain, so SIGTERM is not held by viewers.
  const open = new Set<ServerResponse>();
  app.addHook('preClose', async () => { for (const raw of open) raw.end(); open.clear(); });

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

  // Task 3.58: last real success per integration, recomputed from stored rows on every call.
  app.get('/api/wiring', async (_request, reply) => {
    reply.header('cache-control', 'no-store');
    return computeWiring(options.database, { commit: options.commit ?? 'uncommitted' });
  });

  // Server-sent events: one `payment` event per settled or failed note, with `id` = seq for Last-Event-ID resume.
  app.get<{ Querystring: { after?: string } }>('/live', async (request, reply) => {
    if (options.feed.size >= maxClients) {
      return reply.code(503).header('retry-after', '30').send({ error: 'busy', message: 'Too many live viewers. Retry shortly.' });
    }
    const client = options.clientKey(request);
    if ((streams.get(client) ?? 0) >= perClient) {
      return reply.code(429).header('retry-after', '30')
        .send({ error: 'too_many_streams', message: 'This network already has the most live views open. Close one and retry.' });
    }
    streams.set(client, (streams.get(client) ?? 0) + 1);
    const release = () => {
      const left = (streams.get(client) ?? 1) - 1;
      if (left > 0) streams.set(client, left); else streams.delete(client);
    };
    // Registered as soon as the slot is taken, so a viewer that leaves during setup still frees it.
    reply.raw.once('close', release);
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
    const write = (text: string) => { writeCapped(raw, text, maxBuffered); };
    const send = (event: PaymentEvent) => {
      if (event.seq <= lastSent) return;
      lastSent = event.seq;
      write(frame(event));
    };
    open.add(raw);
    const unsubscribe = options.feed.subscribe(event => { if (pending) pending.push(event); else send(event); });
    const keepalive = setInterval(() => write(': keepalive\n\n'), KEEPALIVE_MS);
    keepalive.unref();
    raw.on('close', () => { clearInterval(keepalive); unsubscribe(); open.delete(raw); });

    // Backlog replay respects backpressure: after each page it waits for the socket to drain.
    const drained = () => new Promise<boolean>(resolve => {
      if (raw.destroyed) return resolve(false);
      if (!raw.writableNeedDrain) return resolve(true);
      const done = (ok: boolean) => { clearTimeout(timer); raw.off('drain', onDrain); raw.off('close', onClose); resolve(ok); };
      const onDrain = () => done(true), onClose = () => done(false);
      const timer = setTimeout(() => { raw.destroy(); done(false); }, DRAIN_TIMEOUT_MS);
      raw.on('drain', onDrain); raw.on('close', onClose);
    });
    const page = (events: PaymentEvent[]) => { for (const event of events) if (event.seq > lastSent) { lastSent = event.seq; raw.write(frame(event)); } };

    try {
      if (resume === null) {
        page(await options.store.latest(BACKLOG));
      } else {
        // Page forward from the resume point so no missed payment is skipped; past RESUME_MAX, say so instead.
        let sent = 0;
        for (;;) {
          const events = await options.store.since(lastSent, RESUME_PAGE);
          page(events);
          sent += events.length;
          if (!(await drained()) || events.length < RESUME_PAGE) break;
          if (sent >= RESUME_MAX) {
            lastSent = await options.store.maxSeq();
            write(`id: ${lastSent}\nevent: reset\ndata: {"reason":"gap_too_large","reload":"/api/stats"}\n\n`);
            break;
          }
        }
      }
    } catch {
      write('event: error\ndata: {"error":"backlog_unavailable"}\n\n');
    }
    const queued = pending;
    pending = null;
    if (!raw.destroyed) for (const event of queued.sort((a, b) => a.seq - b.seq)) send(event);
  });
}
