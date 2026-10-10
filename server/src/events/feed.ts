import type { EventStore, PaymentEvent } from './store.js';

type Listener = (event: PaymentEvent) => void;

/**
 * Polls the settlement journal and fans each new event out to SSE listeners. One poller per process;
 * the 500 ms default keeps a confirmation on /live well inside the 2 s target (PLAN.md 2.10).
 */
export class EventFeed {
  private readonly listeners = new Set<Listener>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly store: EventStore, private readonly intervalMs = 500) {}

  get size(): number { return this.listeners.size; }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** One projection pass. Exposed for tests; the timer calls it. */
  async tick(): Promise<PaymentEvent[]> {
    if (this.running) return [];
    this.running = true;
    try {
      const events = await this.store.project();
      for (const event of events) for (const listener of this.listeners) listener(event);
      return events;
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
