import type { EventStore, PaymentEvent } from './store.js';

type Listener = (event: PaymentEvent) => void;

const PAGE = 200;
const MAX_PAGES_PER_TICK = 10;

/**
 * Polls the settlement journal and fans each new event out to SSE listeners. One poller per process;
 * the 500 ms default keeps a confirmation on /live well inside the 2 s target (PLAN.md 2.10).
 * Delivery reads payment_events from the feed's own seq position, so rows saved by a projection that
 * later failed part way are still broadcast.
 */
export class EventFeed {
  private readonly listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private position = 0;

  constructor(private readonly store: EventStore, private readonly intervalMs = 500) {}

  get size(): number { return this.listeners.size; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Starts delivery after the newest saved event; earlier ones are served as /live backlog instead. */
  async init(): Promise<void> { this.position = await this.store.maxSeq(); }

  /** One projection and delivery pass; returns what it delivered. Exposed for tests; the timer calls it. */
  async tick(): Promise<PaymentEvent[]> {
    if (this.running) return [];
    this.running = true;
    try {
      let failure: unknown = null;
      // Each pass runs even if the other fails; a transient error is rethrown after delivery so the next tick retries.
      try { await this.store.projectUploads(); } catch (error) { failure = error; }
      try { await this.store.project(); } catch (error) { failure ??= error; }
      const delivered: PaymentEvent[] = [];
      for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
        const events = await this.store.since(this.position, PAGE);
        for (const event of events) {
          this.position = event.seq;
          delivered.push(event);
          for (const listener of this.listeners) listener(event);
        }
        if (events.length < PAGE) break;
      }
      if (failure) throw failure;
      return delivered;
    } finally { this.running = false; }
  }

  start(onError: (error: unknown) => void): void {
    if (this.timer) return;
    this.timer = setInterval(() => { this.tick().catch(onError); }, this.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.listeners.clear();
  }
}
