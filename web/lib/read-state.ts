// What a cached server read hands a page (lib/cached-read.ts), decided here without
// next/cache so the rules are unit-tested (unit/read-state.test.ts).
//
// Every value says how old it is, and a page must show which state it has:
// - current: a successful read younger than the read's window (10 s for devnet, 60 s for
//   GitHub) at the moment the page renders, with no newer read that failed, with its time
//   and exact age. Only a current value may make a claim Live;
// - cached: an older good read, with its time and age. Never Live;
// - stale: an older good read PLUS the newer read that failed (or was not made), with its
//   reason and time. A page shows both; it never shows the older value as if it were current;
// - failed: no value at all, only the reason and the time.
//
// Age and current-ness are decided when the page renders, never when it asked: a page awaits
// several reads, and a value that was current when it was handed over can be too old by the
// time the last read arrives. resolveRead stamps its answer after its own awaits, and a page
// re-stamps every read at one render time (shownAt) before deciding any claim.
//
// The load on devnet and GitHub is bounded whatever the traffic (ReadGate below): page views
// that want the same read while it is running share it, a current value is reused instead of
// read again, each read has a budget per window in this server process, and a rate-limited
// answer pauses that read instead of retrying it.

import { RpcError, describeFailure } from "./solana";

/** A read that failed, or was not made (`notMade`): why, and when (this server's clock). */
export interface FailedRead {
  reason: string;
  atMs: number;
  /** True when no request was sent (the read's budget was spent, or a rate limit pause is on). */
  notMade?: true;
}

export type Read<T> =
  | {
      ok: true;
      data: T;
      readAtMs: number;
      /** Null when this is the latest read. Otherwise the newer read that failed or was not made. */
      staleBecause: FailedRead | null;
      /**
       * True when, at shownAtMs, the read was no older than `currentForMs` and no newer read had
       * failed: only then may a claim be Live.
       */
      current: boolean;
      /** When the page shows the value (this server's clock): its age is shownAtMs - readAtMs. */
      shownAtMs: number;
      /** How young a read must be to count as current, for the page to say so. */
      currentForMs: number;
    }
  | ({ ok: false } & FailedRead);

export interface Stamped<T> {
  data: T;
  readAtMs: number;
}

/** No request was sent: the read's budget was spent or a rate-limit pause is on. The message says which. */
export class ReadNotMade extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadNotMade";
  }
}

/** A rate-limited answer: HTTP or JSON-RPC 429 from devnet, or GitHub's spent limit (lib/github.ts). */
export function isRateLimited(error: unknown): boolean {
  if (error instanceof RpcError) return error.code === 429;
  return typeof error === "object" && error !== null && (error as { rateLimited?: unknown }).rateLimited === true;
}

export interface GateLimits {
  /** At most this many upstream reads per key per `perMs`. */
  reads: number;
  perMs: number;
  /** After a rate-limited answer, no read for this key for this long. */
  rateLimitPauseMs: number;
}

/**
 * Bounds upstream reads per key in this server process: a read already running is shared by
 * every caller (single flight), at most `reads` start per `perMs`, and after a rate-limited
 * answer none starts until the pause has passed. A read it refuses throws ReadNotMade.
 */
export class ReadGate {
  private readonly running = new Map<string, Promise<Stamped<unknown>>>();
  private readonly started = new Map<string, number[]>();
  private readonly pausedUntil = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  read<T>(key: string, limits: GateLimits, read: () => Promise<T>): Promise<Stamped<T>> {
    const shared = this.running.get(key);
    if (shared) return shared as Promise<Stamped<T>>;
    const now = this.now();
    const pause = this.pausedUntil.get(key) ?? 0;
    if (now < pause) {
      return Promise.reject(
        new ReadNotMade(`the last read was rate limited, so this server waits ${Math.ceil((pause - now) / 1000)} s more before reading again`),
      );
    }
    const recent = (this.started.get(key) ?? []).filter((t) => now - t < limits.perMs);
    if (recent.length >= limits.reads) {
      return Promise.reject(
        new ReadNotMade(`this server already made ${recent.length} reads in the last ${limits.perMs / 1000} s, so it did not read again`),
      );
    }
    recent.push(now);
    this.started.set(key, recent);
    const run = Promise.resolve()
      .then(read)
      .then(
        (data): Stamped<T> => ({ data, readAtMs: this.now() }),
        (e: unknown) => {
          // Never retried here: a rate-limited read waits out the pause.
          if (isRateLimited(e)) this.pausedUntil.set(key, this.now() + limits.rateLimitPauseMs);
          throw e;
        },
      );
    this.running.set(key, run);
    const done = () => {
      if (this.running.get(key) === run) this.running.delete(key);
    };
    run.then(done, done);
    return run;
  }
}

/**
 * The same read as the page shows it at `shownAtMs`: its age and whether it is current are
 * decided at that moment. A page calls this for every read with one render time, after all
 * of its reads have arrived and before it decides any claim.
 */
export function shownAt<T>(read: Read<T>, shownAtMs: number): Read<T> {
  if (!read.ok) return read;
  return {
    ...read,
    shownAtMs,
    current: read.staleBecause === null && shownAtMs - read.readAtMs <= read.currentForMs,
  };
}

/**
 * Every read a page made, re-stamped at one render time (this server's clock, read once):
 * call it after all of the page's reads have arrived, before deciding any claim.
 */
export function shownTogether<T extends readonly Read<unknown>[]>(reads: readonly [...T]): T {
  const renderedAtMs = Date.now();
  return reads.map((read) => shownAt(read, renderedAtMs)) as unknown as T;
}

export interface ResolveInput<T> {
  /** The cache: its entry (possibly old), or it throws when it has none and the read failed. */
  cached: () => Promise<Stamped<T>>;
  /** A read made now, past the cache (through the ReadGate, so it may be shared or refused). */
  readNow: () => Promise<Stamped<T>>;
  /** Cached mode: an entry older than this is read again now instead of shown. */
  maxAgeMs: number;
  /** A read younger than this counts as current. */
  currentForMs: number;
  /**
   * needCurrent: a kept read younger than this is reused instead of read again. Shorter than
   * currentForMs, so a reused read is still current when the page renders a moment later.
   */
  reuseForMs?: number;
  /** The latest failure recorded for this key, for example by a background refresh. */
  lastFailure: () => FailedRead | null;
  /** The latest successful read made now (readNow) for this key, kept in this server process. */
  lastGoodRead: () => Stamped<T> | null;
  /** Keeps a successful read made now, with its own read time, for the next page view. */
  keepGoodRead: (entry: Stamped<T>) => void;
  now: () => number;
  /**
   * For a page whose claims say Live: reuse a current read, else read now; the cache is the
   * fallback only when that read fails or is not made, and its value is then never current.
   */
  needCurrent?: boolean;
}

export async function resolveRead<T>(input: ResolveInput<T>): Promise<Read<T>> {
  // Stamped after every await: the age is the age when this answer is handed over.
  const answer = (entry: Stamped<T>, staleBecause: FailedRead | null): Read<T> =>
    shownAt(
      {
        ok: true,
        data: entry.data,
        readAtMs: entry.readAtMs,
        staleBecause,
        current: false,
        shownAtMs: 0,
        currentForMs: input.currentForMs,
      },
      input.now(),
    );
  const failureOf = (e: unknown): FailedRead =>
    e instanceof ReadNotMade ? { reason: e.message, atMs: input.now(), notMade: true } : { reason: describeFailure(e), atMs: input.now() };
  const newest = (a: Stamped<T> | null, b: Stamped<T> | null) => (a && (!b || a.readAtMs > b.readAtMs) ? a : b);

  if (input.needCurrent) {
    const kept = input.lastGoodRead();
    // A read that failed after the kept one (the cache's background refresh, another page's
    // read) makes it stale: it is not reused however young, and if no new read succeeds the
    // page shows that failure.
    const known = input.lastFailure();
    const keptFailedSince = kept !== null && known !== null && known.atMs > kept.readAtMs;
    if (kept && !keptFailedSince && input.now() - kept.readAtMs <= (input.reuseForMs ?? input.currentForMs)) return answer(kept, null);
    let failure: FailedRead;
    try {
      const entry = await input.readNow();
      input.keepGoodRead(entry);
      return answer(entry, null);
    } catch (e) {
      failure = failureOf(e);
    }
    let cachedEntry: Stamped<T> | null = null;
    try {
      cachedEntry = await input.cached();
    } catch {
      // Nothing cached either; the failure above is the answer.
    }
    const entry = newest(kept, cachedEntry);
    if (!entry) return { ok: false, ...failure };
    if (entry.readAtMs > failure.atMs) return answer(entry, null);
    // When no read was sent now, the recorded failure since the entry says more than "not made".
    const recorded = known !== null && known.atMs > entry.readAtMs ? known : null;
    return answer(entry, failure.notMade && recorded ? recorded : failure);
  }

  let entry: Stamped<T> | null = null;
  let failure: FailedRead | null = null;
  try {
    entry = await input.cached();
  } catch (e) {
    failure = failureOf(e);
  }
  // The cache cannot be written from here, and while its own background refresh keeps
  // failing it keeps answering with its old entry. A read made now is kept beside it, so the
  // next page view uses that read (it is newer) instead of reading devnet again. When the
  // cache has nothing, the kept read is shown as the last good read, with the failure.
  const kept = input.lastGoodRead();
  let staleBecause: FailedRead | null = null;
  if (!entry && kept && failure) staleBecause = failure;
  entry = newest(kept, entry);
  if (!entry) {
    return { ok: false, ...(failure ?? { reason: "no read was made", atMs: input.now() }) };
  }
  if (!staleBecause && input.now() - entry.readAtMs > input.maxAgeMs) {
    try {
      entry = await input.readNow();
      input.keepGoodRead(entry);
    } catch (e) {
      // The older entry is still the last good read; the page says this read failed.
      staleBecause = failureOf(e);
    }
  }
  if (!staleBecause) {
    // A read that failed after this entry was taken (the cache's background refresh in this
    // server process) makes the entry stale too.
    const known = input.lastFailure();
    if (known && known.atMs > entry.readAtMs) staleBecause = known;
  }
  return answer(entry, staleBecause);
}
