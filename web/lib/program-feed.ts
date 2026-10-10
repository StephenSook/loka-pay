// The /live feed's engine, kept out of React: the program's latest transactions
// (getSignaturesForAddress), their details (getTransaction), then a logsSubscribe
// WebSocket that adds each new transaction as it lands. Browser only (it opens a
// WebSocket). The component in components/live-feed.tsx subscribes to its state.
//
// The connection state is the socket's real state: "live" only after the node confirmed
// the subscription, "reconnecting" with the real attempt number and delay, "failed" after
// too many closes in a row. After a reconnect the history is read again, so a transaction
// that landed while the socket was down still appears.
//
// Public devnet allows 10 getTransaction calls per 10 seconds per IP, so details are read
// in batches of DETAIL_BATCH, newest first, waiting between batches; a row whose details
// were refused for the limit stays "reading" and is tried again in the next batch.

import { summarizeLogs, summarizeTransaction, type TxSummary } from "./logs";
import { WS_URL, describeFailure, rpc, rpcBatch } from "./solana";

export const HISTORY_LIMIT = 20;
export const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const DETAIL_BATCH = 8;
const DETAIL_ROUNDS = 6;
const DETAIL_WAIT_MS = 11_000;
const LIVE_DETAIL_ATTEMPTS = 3;
const LIVE_DETAIL_DELAY_MS = 1500;
const SUBSCRIBE_ID = 1;

/** "reading": not read yet; "read": from getTransaction; "unread": gave up (the row says so). */
export type Details = "reading" | "read" | "unread";

export type Row = TxSummary & { arrivedLive: boolean; seenAtMs: number | null; details: Details };

export type Connection =
  | { kind: "connecting" }
  | { kind: "live"; sinceMs: number }
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

const TX_OPTIONS = { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" } as const;

interface SignatureInfo {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number | null;
}

function isSignatureInfo(value: unknown): value is SignatureInfo {
  const v = value as SignatureInfo | null;
  return typeof v === "object" && v !== null && typeof v.signature === "string" && typeof v.slot === "number";
}

/** The latest signatures, as rows whose details are still to be read. */
export async function loadSignatures(programId: string): Promise<Row[]> {
  const result = await rpc("getSignaturesForAddress", [programId, { limit: HISTORY_LIMIT, commitment: "confirmed" }]);
  if (!Array.isArray(result) || !result.every(isSignatureInfo)) {
    throw new Error("getSignaturesForAddress answered an unexpected shape");
  }
  return result.map((s) => ({
    signature: s.signature,
    slot: s.slot,
    blockTime: typeof s.blockTime === "number" ? s.blockTime : null,
    failed: s.err !== null && s.err !== undefined,
    actions: [],
    amounts: [],
    error: null,
    errText: s.err === null || s.err === undefined ? null : JSON.stringify(s.err),
    truncated: false,
    arrivedLive: false,
    seenAtMs: null,
    details: "reading",
  }));
}

type DetailOutcome = { kind: "read"; summary: TxSummary } | { kind: "retry" } | { kind: "unread" };

/** getTransaction for several signatures in one batch. A per-call rate limit means "retry later". */
export async function loadDetails(signatures: string[], programId: string): Promise<DetailOutcome[]> {
  let outcomes: Awaited<ReturnType<typeof rpcBatch>>;
  try {
    outcomes = await rpcBatch(signatures.map((s) => ({ method: "getTransaction", params: [s, TX_OPTIONS] })));
  } catch {
    // The whole request was refused or failed: every row waits for the next batch.
    return signatures.map((): DetailOutcome => ({ kind: "retry" }));
  }
  return outcomes.map((outcome): DetailOutcome => {
    if (outcome.ok) {
      const summary = outcome.result === null ? null : summarizeTransaction(outcome.result, programId);
      return summary ? { kind: "read", summary } : { kind: "retry" };
    }
    return outcome.error.code === 429 ? { kind: "retry" } : { kind: "unread" };
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface LogsNotification {
  method?: unknown;
  params?: { result?: { context?: { slot?: unknown }; value?: { signature?: unknown; err?: unknown; logs?: unknown } } };
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
  private enriching = false;

  constructor(
    private readonly programId: string,
    private readonly wsUrl: string = WS_URL,
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
    void this.refreshHistory();
    this.connect();
  }

  stop(): void {
    this.running = false;
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
    const rows = [...this.rows.values()].sort(
      (a, b) => (b.slot ?? Number.MAX_SAFE_INTEGER) - (a.slot ?? Number.MAX_SAFE_INTEGER),
    );
    this.state = { ...this.state, ...patch, rows };
    for (const listener of this.listeners) listener(this.state);
  }

  private setRow(row: Row): void {
    this.rows.set(row.signature, row);
  }

  private async refreshHistory(): Promise<void> {
    try {
      const loaded = await loadSignatures(this.programId);
      if (!this.running) return;
      for (const row of loaded) {
        // A row already shown (from an earlier read or the socket) keeps what it has.
        if (!this.rows.has(row.signature)) this.setRow(row);
      }
      this.update({ history: { kind: "ok", atMs: Date.now(), count: loaded.length } });
      void this.enrich();
    } catch (e) {
      if (!this.running) return;
      this.update({ history: { kind: "failed", atMs: Date.now(), reason: describeFailure(e) } });
    }
  }

  /** Reads details for rows still "reading", newest first, a batch at a time. */
  private async enrich(): Promise<void> {
    if (this.enriching) return;
    this.enriching = true;
    try {
      for (let round = 0; round < DETAIL_ROUNDS && this.running; round += 1) {
        const pending = this.state.rows.filter((r) => r.details === "reading" && !r.arrivedLive).slice(0, DETAIL_BATCH);
        if (pending.length === 0) return;
        if (round > 0) await sleep(DETAIL_WAIT_MS);
        if (!this.running) return;
        const outcomes = await loadDetails(
          pending.map((r) => r.signature),
          this.programId,
        );
        pending.forEach((row, i) => {
          const outcome = outcomes[i];
          const current = this.rows.get(row.signature) ?? row;
          if (outcome.kind === "read") {
            this.setRow({ ...current, ...outcome.summary, blockTime: outcome.summary.blockTime ?? current.blockTime, details: "read" });
          } else if (outcome.kind === "unread") {
            this.setRow({ ...current, details: "unread" });
          }
        });
        this.update({});
      }
      // Out of rounds: say so on each row still waiting.
      for (const row of this.rows.values()) if (row.details === "reading" && !row.arrivedLive) this.setRow({ ...row, details: "unread" });
      this.update({});
    } finally {
      this.enriching = false;
    }
  }

  private onNotification(message: LogsNotification): void {
    const value = message.params?.result?.value;
    if (!value || typeof value.signature !== "string" || !Array.isArray(value.logs)) return;
    const slotValue = message.params?.result?.context?.slot;
    const slot = typeof slotValue === "number" ? slotValue : null;
    const logs = value.logs.filter((l): l is string => typeof l === "string");
    const summary = summarizeLogs(value.signature, slot, value.err ?? null, logs, this.programId);
    const now = Date.now();
    // A transaction already shown from history keeps its fuller details.
    if (this.rows.has(summary.signature)) return;
    this.setRow({ ...summary, arrivedLive: true, seenAtMs: now, details: "reading" });
    const what = summary.actions.join(", ") || "no loka_vault instruction";
    this.update({ lastEventMs: now, announcement: `New transaction: ${what}, ${summary.failed ? "failed" : "succeeded"}.` });
    void this.enrichLive(summary.signature);
  }

  /** The block time and instruction data of a transaction that just arrived, retried briefly. */
  private async enrichLive(signature: string): Promise<void> {
    for (let attempt = 0; attempt < LIVE_DETAIL_ATTEMPTS && this.running; attempt += 1) {
      if (attempt > 0) await sleep(LIVE_DETAIL_DELAY_MS);
      const [outcome] = await loadDetails([signature], this.programId);
      const current = this.rows.get(signature);
      if (!current || !this.running) return;
      if (outcome.kind === "read") {
        this.setRow({ ...current, ...outcome.summary, blockTime: outcome.summary.blockTime ?? current.blockTime, details: "read" });
        this.update({});
        return;
      }
      if (outcome.kind === "unread") break;
    }
    const current = this.rows.get(signature);
    if (current && this.running) {
      this.setRow({ ...current, details: "unread" });
      this.update({});
    }
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
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SUBSCRIBE_ID,
          method: "logsSubscribe",
          params: [{ mentions: [this.programId] }, { commitment: "confirmed" }],
        }),
      );
    };
    ws.onmessage = (event) => {
      if (this.socket !== ws) return;
      let message: { id?: unknown; result?: unknown; method?: unknown };
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message.id === SUBSCRIBE_ID) {
        if (typeof message.result === "number") {
          this.attempts = 0;
          this.update({ connection: { kind: "live", sinceMs: Date.now() } });
          if (this.everLive) void this.refreshHistory();
          this.everLive = true;
        } else {
          // The node refused the subscription; treat it like a closed socket.
          ws.close();
        }
      } else if (message.method === "logsNotification") {
        this.onNotification(message as LogsNotification);
      }
    };
    ws.onclose = () => {
      if (this.socket !== ws || !this.running) return;
      this.socket = null;
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
