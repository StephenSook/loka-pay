// The /live feed's engine, kept out of React: the program's latest transactions
// (getSignaturesForAddress), their details (getTransaction), then a logsSubscribe
// WebSocket that adds each new transaction as it lands. Browser only (it opens a
// WebSocket). The component in components/live-feed.tsx subscribes to its state.
//
// The connection state is the socket's real state: "live" only after the node confirmed
// the subscription, "reconnecting" with the real attempt number and delay, "failed" after
// too many closes in a row. After a reconnect the history is read again, so a transaction
// that landed while the socket was down still appears, and a row whose details were given
// up on ("unread") is read again.
//
// A socket can also stall without closing, so "live" needs traffic as well: the feed also
// subscribes to slots (devnet sends a new slot more than once a second), and when no valid
// message arrives for STALL_AFTER_MS the state turns "stalled" with how long it has been
// silent. Only a message this feed recognizes counts (classifyMessage): a subscription
// acknowledgement, or a slot or logs notification for this socket's own subscription. Text
// that is not JSON, or a message for another subscription, never keeps or restores "live".
// The next valid message turns it "live" again and reads the history again, since a
// transaction may have landed during the silence.
//
// The feed keeps the newest MAX_ROWS rows, so a kiosk left open all weekend does not grow
// without limit.
//
// Public devnet allows 10 getTransaction calls per 10 seconds per IP, so every detail read,
// for history rows and for rows that just arrived over the socket alike, goes through one
// queue (pump): one request at a time, newest rows first, at most DETAIL_BUDGET calls in any
// DETAIL_WINDOW_MS, and nothing at all for RATE_LIMIT_PAUSE_MS after a rate-limited answer.
// A burst of notifications therefore never becomes a burst of requests. A row dropped past
// MAX_ROWS leaves the queue, and an answer for it that was already on its way is discarded.
// Each answer in a batch is read on its own: one this page cannot read marks only its own
// row "unavailable", and the other rows of the batch still get their details.

import { resultOf, summarizeLogs, summarizeTransaction, type TxResult, type TxSummary } from "./logs";
import { RpcError, WS_URL, describeFailure, rpc, rpcBatch, type RpcOutcome } from "./solana";
import { isUnixSeconds } from "./time";

export const HISTORY_LIMIT = 20;
export const MAX_ROWS = 100;
export const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
/** getTransaction calls in one batch request. */
export const DETAIL_BATCH = 8;
/** At most this many getTransaction calls in any DETAIL_WINDOW_MS, under devnet's 10 per 10 s. */
export const DETAIL_BUDGET = 8;
export const DETAIL_WINDOW_MS = 11_000;
/** No getTransaction call for this long after a rate-limited answer (devnet answers Retry-After: 10). */
export const RATE_LIMIT_PAUSE_MS = 11_000;
/** A row answered "not found yet", or whose request failed, is tried again after this long. */
export const DETAIL_RETRY_MS = 1500;
/** A row is given up on ("unread") after this many tries. */
export const DETAIL_ATTEMPTS = 6;
const SUBSCRIBE_ID = 1;
const SLOT_SUBSCRIBE_ID = 2;
/** With nothing on the socket for longer than this, the connection is "stalled", not "live". */
export const STALL_AFTER_MS = 10_000;
const LIVENESS_CHECK_MS = 1000;

/**
 * "reading": not read yet; "read": from getTransaction; "unread": gave up (the row says so);
 * "unavailable": devnet answered, but not with a transaction this page can read (the row
 * says so, and still links the signature to the explorer).
 */
export type Details = "reading" | "read" | "unread" | "unavailable";

export type Row = TxSummary & { arrivedLive: boolean; seenAtMs: number | null; details: Details };

/**
 * The newest `max` rows, newest first by slot (a row with no slot yet, just arrived, on
 * top), and the signatures of the rows past the limit.
 */
export function keepNewest(rows: Iterable<Row>, max: number): { kept: Row[]; dropped: string[] } {
  const sorted = [...rows].sort((a, b) => (b.slot ?? Number.MAX_SAFE_INTEGER) - (a.slot ?? Number.MAX_SAFE_INTEGER));
  return { kept: sorted.slice(0, max), dropped: sorted.slice(max).map((r) => r.signature) };
}

/**
 * The rows a history read adds or changes. A row already shown keeps what it has, except
 * that after a reconnect (`retryUnread`) a row whose details were given up on goes back to
 * "reading", so its details are tried again.
 */
export function mergeHistory(current: ReadonlyMap<string, Row>, loaded: readonly Row[], retryUnread: boolean): Row[] {
  const changed: Row[] = [];
  for (const row of loaded) {
    const shown = current.get(row.signature);
    if (!shown) changed.push(row);
    else if (retryUnread && shown.details === "unread") changed.push({ ...shown, details: "reading" });
  }
  return changed;
}

export type Connection =
  | { kind: "connecting" }
  | { kind: "live"; sinceMs: number }
  /** Subscribed since `sinceMs`, but nothing has arrived on the socket for `silentMs`. */
  | { kind: "stalled"; sinceMs: number; silentMs: number }
  | { kind: "reconnecting"; attempt: number; retryInMs: number }
  | { kind: "failed"; reason: string };

export type History = { kind: "loading" } | { kind: "ok"; atMs: number; count: number } | { kind: "failed"; atMs: number; reason: string };

export interface FeedState {
  /** Newest first. */
  rows: Row[];
  history: History;
  connection: Connection;
  /** When the last new transaction arrived over the socket (this browser's clock). */
  lastEventMs: number | null;
  /** A sentence for screen readers about the newest arrival. */
  announcement: string;
}

export const INITIAL_FEED_STATE: FeedState = {
  rows: [],
  history: { kind: "loading" },
  connection: { kind: "connecting" },
  lastEventMs: null,
  announcement: "",
};

/** The time and timers: the browser's, or a fake one in unit/program-feed.test.ts. */
export interface FeedClock {
  now(): number;
  /** Calls `fn` every `ms` milliseconds until the returned function is called. */
  every(ms: number, fn: () => void): () => void;
  /** Resolves after `ms` milliseconds. */
  sleep(ms: number): Promise<void>;
}

export const SYSTEM_CLOCK: FeedClock = {
  now: () => Date.now(),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

const TX_OPTIONS = { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" } as const;

interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
}

function isSignatureInfo(value: unknown): value is SignatureInfo {
  const v = value as SignatureInfo | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.signature === "string" &&
    typeof v.slot === "number" &&
    // A block time is null (not known) or one a page can show; anything else is the wrong shape.
    (v.blockTime === null || v.blockTime === undefined || isUnixSeconds(v.blockTime))
  );
}

/** The latest signatures, as rows whose details are still to be read. */
export async function loadSignatures(programId: string): Promise<Row[]> {
  return rowsFromSignatures(await rpc("getSignaturesForAddress", [programId, { limit: HISTORY_LIMIT, commitment: "confirmed" }]));
}

/** getSignaturesForAddress's answer as rows whose details are still to be read. Throws on the wrong shape. */
export function rowsFromSignatures(result: unknown): Row[] {
  if (!Array.isArray(result) || !result.every(isSignatureInfo)) {
    throw new Error("getSignaturesForAddress answered an unexpected shape");
  }
  return result.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: isUnixSeconds(s.blockTime) ? s.blockTime : null,
    // A missing err field is an unknown result, never a success.
    result: resultOf(s.err),
    actions: [],
    amounts: [],
    error: null,
    errText: resultOf(s.err) === "failed" ? JSON.stringify(s.err) : null,
    truncated: false,
    arrivedLive: false,
    seenAtMs: null,
    details: "reading",
  }));
}

export type DetailOutcome =
  | { kind: "read"; summary: TxSummary }
  /** Try again later; `rateLimited` pauses every detail read (RATE_LIMIT_PAUSE_MS). */
  | { kind: "retry"; rateLimited: boolean }
  | { kind: "unread" }
  | { kind: "unavailable" };

/**
 * One getTransaction answer. A per-call rate limit or a null result (not found yet) means
 * "retry later"; another error means "unread". An answer of the wrong shape, or one the
 * parser throws on, is "unavailable" for this row only: it never throws, so it cannot stop
 * the other answers of its batch from being read.
 */
export function detailOutcome(outcome: RpcOutcome, programId: string): DetailOutcome {
  if (!outcome.ok) return outcome.error.code === 429 ? { kind: "retry", rateLimited: true } : { kind: "unread" };
  if (outcome.result === null) return { kind: "retry", rateLimited: false };
  try {
    const summary = summarizeTransaction(outcome.result, programId);
    return summary ? { kind: "read", summary } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

/** getTransaction for several signatures in one batch, one outcome per signature in order. */
export async function loadDetails(signatures: string[], programId: string): Promise<DetailOutcome[]> {
  let outcomes: RpcOutcome[];
  try {
    outcomes = await rpcBatch(signatures.map((s) => ({ method: "getTransaction", params: [s, TX_OPTIONS] })));
  } catch (e) {
    // The whole request was refused or failed: every row waits for a later batch, and a
    // rate-limited request pauses the queue.
    const rateLimited = e instanceof RpcError && e.code === 429;
    return signatures.map((): DetailOutcome => ({ kind: "retry", rateLimited }));
  }
  return outcomes.map((outcome) => detailOutcome(outcome, programId));
}

/**
 * A row with the details getTransaction answered. An answer that does not say how the
 * transaction ended (null metadata, no err field) keeps the result an earlier answer gave,
 * so a row known to have failed is never turned into a success or an unknown.
 */
export function mergeDetails(current: Row, summary: TxSummary): Row {
  const known = summary.result !== "unknown";
  return {
    ...current,
    ...summary,
    blockTime: summary.blockTime ?? current.blockTime,
    result: known ? summary.result : current.result,
    errText: known ? summary.errText : current.errText,
    error: summary.error ?? current.error,
    details: "read",
  };
}

/** The words for a result, for the screen-reader announcement. */
function resultWords(result: TxResult): string {
  return result === "unknown" ? "result unknown" : result;
}

interface LogsNotification {
  method?: unknown;
  params?: { result?: { context?: { slot?: unknown }; value?: { signature?: unknown; err?: unknown; logs?: unknown } } };
}

/** The subscription ids the node gave this socket, once it has acknowledged each. */
export interface Subscriptions {
  logs: number | null;
  slot: number | null;
}

export type SocketMessage =
  | { kind: "logs-ack"; subscription: number }
  | { kind: "logs-refused" }
  | { kind: "slot-ack"; subscription: number }
  | { kind: "logs"; notification: LogsNotification }
  | { kind: "slot" }
  /** Not JSON, not JSON-RPC, for another subscription, or of the wrong shape: no evidence the subscription works. */
  | { kind: "unrecognized" };

const isSubscriptionId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** What one WebSocket message is, checked against this socket's own subscriptions. */
export function classifyMessage(text: string, subs: Subscriptions): SocketMessage {
  let m: { id?: unknown; result?: unknown; method?: unknown; params?: { subscription?: unknown; result?: unknown } };
  try {
    m = JSON.parse(text);
  } catch {
    return { kind: "unrecognized" };
  }
  if (typeof m !== "object" || m === null) return { kind: "unrecognized" };
  if (m.id === SUBSCRIBE_ID) return isSubscriptionId(m.result) ? { kind: "logs-ack", subscription: m.result } : { kind: "logs-refused" };
  if (m.id === SLOT_SUBSCRIBE_ID) return isSubscriptionId(m.result) ? { kind: "slot-ack", subscription: m.result } : { kind: "unrecognized" };
  const params = typeof m.params === "object" && m.params !== null ? m.params : null;
  if (!params) return { kind: "unrecognized" };
  if (m.method === "slotNotification") {
    const r = params.result as { slot?: unknown } | null;
    const ok = subs.slot !== null && params.subscription === subs.slot && typeof r === "object" && r !== null && isSubscriptionId(r.slot);
    return ok ? { kind: "slot" } : { kind: "unrecognized" };
  }
  if (m.method === "logsNotification") {
    const r = params.result as { context?: { slot?: unknown }; value?: { signature?: unknown; logs?: unknown } } | null | undefined;
    const value = r?.value;
    const slot = r?.context?.slot;
    const ok =
      subs.logs !== null &&
      params.subscription === subs.logs &&
      typeof value === "object" &&
      value !== null &&
      typeof value.signature === "string" &&
      Array.isArray(value.logs) &&
      value.logs.every((l) => typeof l === "string") &&
      (slot === undefined || isSubscriptionId(slot));
    return ok ? { kind: "logs", notification: m as LogsNotification } : { kind: "unrecognized" };
  }
  return { kind: "unrecognized" };
}

export class ProgramFeed {
  private state: FeedState = INITIAL_FEED_STATE;
  private readonly rows = new Map<string, Row>();
  private readonly listeners = new Set<(state: FeedState) => void>();
  private socket: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private everLive = false;
  private running = false;
  /** True while the detail queue (pump) is running; there is only ever one. */
  private pumping = false;
  /** Wakes the queue from a wait early, when a row arrives or the feed stops. */
  private wake: (() => void) | null = null;
  /** Tries so far, per row still waiting for its details. */
  private readonly tries = new Map<string, number>();
  /** When a waiting row may be tried again (this.clock), after "not found yet" or a failed request. */
  private readonly notBefore = new Map<string, number>();
  /** When each getTransaction call of the last DETAIL_WINDOW_MS was sent, oldest first. */
  private sent: number[] = [];
  /** No detail read before this time (this.clock), after a rate-limited answer. */
  private pausedUntilMs = 0;
  /** When the current socket last sent a message classifyMessage recognized (this.clock). */
  private lastMessageMs = 0;
  /** The current socket's subscription ids, once acknowledged. */
  private subs: Subscriptions = { logs: null, slot: null };
  /** Stops the liveness check; set while a subscription is confirmed. */
  private unwatch: (() => void) | null = null;

  constructor(
    private readonly programId: string,
    private readonly wsUrl: string = WS_URL,
    private readonly clock: FeedClock = SYSTEM_CLOCK,
  ) {}

  subscribe(listener: (state: FeedState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): FeedState {
    return this.state;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.refreshHistory(false);
    this.connect();
  }

  stop(): void {
    this.running = false;
    this.wake?.();
    this.stopWatching();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const ws = this.socket;
    this.socket = null;
    ws?.close();
  }

  /** After "failed": start counting again and reconnect now. */
  retry(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.attempts = 0;
    this.update({ connection: { kind: "connecting" } });
    this.connect();
  }

  private update(patch: Partial<FeedState>): void {
    const { kept, dropped } = keepNewest(this.rows.values(), MAX_ROWS);
    // A dropped row also leaves the detail queue.
    for (const signature of dropped) {
      this.rows.delete(signature);
      this.forget(signature);
    }
    this.state = { ...this.state, ...patch, rows: kept };
    for (const listener of this.listeners) listener(this.state);
  }

  private setRow(row: Row): void {
    this.rows.set(row.signature, row);
  }

  private startWatching(): void {
    this.stopWatching();
    this.unwatch = this.clock.every(LIVENESS_CHECK_MS, () => this.checkLiveness());
  }

  private stopWatching(): void {
    this.unwatch?.();
    this.unwatch = null;
  }

  /** "live" turns "stalled" once the socket has been silent past STALL_AFTER_MS. */
  private checkLiveness(): void {
    const c = this.state.connection;
    if (c.kind !== "live" && c.kind !== "stalled") return;
    const silentMs = this.clock.now() - this.lastMessageMs;
    if (silentMs > STALL_AFTER_MS) this.update({ connection: { kind: "stalled", sinceMs: c.sinceMs, silentMs } });
  }

  /** `retryUnread` after a reconnect: rows whose details were given up on are read again. */
  private async refreshHistory(retryUnread: boolean): Promise<void> {
    try {
      const loaded = await loadSignatures(this.programId);
      if (!this.running) return;
      for (const row of mergeHistory(this.rows, loaded, retryUnread)) this.setRow(row);
      this.update({ history: { kind: "ok", atMs: this.clock.now(), count: loaded.length } });
      void this.pump();
    } catch (e) {
      if (!this.running) return;
      this.update({ history: { kind: "failed", atMs: this.clock.now(), reason: describeFailure(e) } });
    }
  }

  private forget(signature: string): void {
    this.tries.delete(signature);
    this.notBefore.delete(signature);
  }

  /**
   * The one detail queue: reads getTransaction for rows still "reading", newest first, one
   * batch request at a time, within the shared budget and any rate-limit pause. Calling it
   * while it runs only wakes it, so it never runs twice.
   */
  private async pump(): Promise<void> {
    if (this.pumping) {
      this.wake?.();
      return;
    }
    this.pumping = true;
    try {
      while (this.running) {
        const now = this.clock.now();
        const waiting = this.state.rows.filter((r) => r.details === "reading");
        if (waiting.length === 0) return;
        this.sent = this.sent.filter((t) => now - t < DETAIL_WINDOW_MS);
        const budget = DETAIL_BUDGET - this.sent.length;
        const due = waiting.filter((r) => (this.notBefore.get(r.signature) ?? 0) <= now);
        if (now >= this.pausedUntilMs && budget > 0 && due.length > 0) {
          const batch = due.slice(0, Math.min(DETAIL_BATCH, budget));
          for (let i = 0; i < batch.length; i += 1) this.sent.push(now);
          const outcomes = await loadDetails(
            batch.map((r) => r.signature),
            this.programId,
          );
          if (!this.running) return;
          this.apply(batch, outcomes);
          continue;
        }
        // Wait for the first moment a read can be sent: the pause ends, the budget's window
        // frees a call, and a waiting row is due.
        const budgetAt = budget > 0 ? now : this.sent[0] + DETAIL_WINDOW_MS;
        const dueAt = due.length > 0 ? now : Math.min(...waiting.map((r) => this.notBefore.get(r.signature) ?? now));
        await this.nap(Math.max(this.pausedUntilMs, budgetAt, dueAt) - now);
      }
    } finally {
      this.pumping = false;
    }
  }

  private async nap(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      this.wake = resolve;
      void this.clock.sleep(Math.max(ms, 1)).then(resolve);
    });
    this.wake = null;
  }

  private apply(batch: Row[], outcomes: DetailOutcome[]): void {
    const now = this.clock.now();
    let rateLimited = false;
    batch.forEach((row, i) => {
      const outcome = outcomes[i];
      const current = this.rows.get(row.signature);
      // Dropped past MAX_ROWS while its details were being read: not added back.
      if (!current) {
        this.forget(row.signature);
        return;
      }
      if (outcome.kind === "read") {
        this.setRow(mergeDetails(current, outcome.summary));
        this.forget(row.signature);
      } else if (outcome.kind === "unread" || outcome.kind === "unavailable") {
        this.setRow({ ...current, details: outcome.kind });
        this.forget(row.signature);
      } else {
        if (outcome.rateLimited) rateLimited = true;
        const tries = (this.tries.get(row.signature) ?? 0) + 1;
        if (tries >= DETAIL_ATTEMPTS) {
          // Out of tries: the row says so.
          this.setRow({ ...current, details: "unread" });
          this.forget(row.signature);
        } else {
          this.tries.set(row.signature, tries);
          this.notBefore.set(row.signature, now + DETAIL_RETRY_MS);
        }
      }
    });
    if (rateLimited) this.pausedUntilMs = now + RATE_LIMIT_PAUSE_MS;
    this.update({});
  }

  private onNotification(message: LogsNotification): void {
    const value = message.params?.result?.value;
    if (!value || typeof value.signature !== "string" || !Array.isArray(value.logs)) return;
    const slotValue = message.params?.result?.context?.slot;
    const slot = typeof slotValue === "number" ? slotValue : null;
    const logs = value.logs.filter((l): l is string => typeof l === "string");
    // A notification without an err field leaves the result unknown until getTransaction says.
    const summary = summarizeLogs(value.signature, slot, value.err, logs, this.programId);
    const now = this.clock.now();
    // A transaction already shown from history keeps its fuller details.
    if (this.rows.has(summary.signature)) return;
    this.setRow({ ...summary, arrivedLive: true, seenAtMs: now, details: "reading" });
    const what = summary.actions.join(", ") || "no loka_vault instruction";
    this.update({ lastEventMs: now, announcement: `New transaction: ${what}, ${resultWords(summary.result)}.` });
    void this.pump();
  }

  private connect(): void {
    if (!this.running) return;
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl);
    } catch (e) {
      this.update({ connection: { kind: "failed", reason: describeFailure(e) } });
      return;
    }
    this.socket = ws;
    this.subs = { logs: null, slot: null };
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SUBSCRIBE_ID,
          method: "logsSubscribe",
          params: [{ mentions: [this.programId] }, { commitment: "confirmed" }],
        }),
      );
      // Slots are the heartbeat for the liveness check: a valid slot notification for this
      // subscription counts, so a refused slot subscription only means a quiet program shows
      // "stalled" (it is: nothing valid arrives).
      ws.send(JSON.stringify({ jsonrpc: "2.0", id: SLOT_SUBSCRIBE_ID, method: "slotSubscribe", params: [] }));
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      const message = classifyMessage(String(event.data), this.subs);
      // Only a recognized message is evidence the subscription works.
      if (message.kind === "unrecognized") return;
      if (message.kind === "logs-refused") {
        // The node refused the subscription; treat it like a closed socket.
        ws.close();
        return;
      }
      this.lastMessageMs = this.clock.now();
      const shown = this.state.connection;
      if (shown.kind === "stalled") {
        // Traffic resumed: live again, and the history is read again for anything missed.
        this.update({ connection: { kind: "live", sinceMs: shown.sinceMs } });
        void this.refreshHistory(true);
      }
      if (message.kind === "logs-ack") {
        this.subs.logs = message.subscription;
        this.attempts = 0;
        this.update({ connection: { kind: "live", sinceMs: this.clock.now() } });
        this.startWatching();
        if (this.everLive) void this.refreshHistory(true);
        this.everLive = true;
      } else if (message.kind === "slot-ack") {
        this.subs.slot = message.subscription;
      } else if (message.kind === "logs") {
        this.onNotification(message.notification);
      }
    };
    ws.onclose = () => {
      if (this.socket !== ws || !this.running) return;
      this.socket = null;
      this.stopWatching();
      // A confirmed subscription reset the count, so this counts closes in a row.
      this.attempts += 1;
      if (this.attempts > MAX_ATTEMPTS) {
        this.update({
          connection: { kind: "failed", reason: `the WebSocket to ${new URL(this.wsUrl).host} closed ${MAX_ATTEMPTS} times in a row` },
        });
        return;
      }
      const delay = BACKOFF_MS[Math.min(this.attempts - 1, BACKOFF_MS.length - 1)];
      this.update({ connection: { kind: "reconnecting", attempt: this.attempts, retryInMs: delay } });
      this.timer = setTimeout(() => this.connect(), delay);
    };
  }
}
