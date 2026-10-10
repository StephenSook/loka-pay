// What a cached server read hands a page (lib/cached-read.ts), decided here without
// next/cache so the rules are unit-tested (unit/read-state.test.ts).
//
// Three states, and a page must show which one it has:
// - fresh: the value and the time it was read;
// - stale: a value from an earlier good read, PLUS the newer read that failed, with its
//   reason and time. A page shows both; it never shows the older value as if it were current;
// - failed: no value at all, only the reason and the time.

import { describeFailure } from "./solana";

/** A read that failed: why, and when (this server's clock). */
export interface FailedRead {
  reason: string;
  atMs: number;
}

export type Read<T> =
  | {
      ok: true;
      data: T;
      readAtMs: number;
      /** Null when this is the latest read. Otherwise the newer read that failed. */
      staleBecause: FailedRead | null;
    }
  | ({ ok: false } & FailedRead);

export interface Stamped<T> {
  data: T;
  readAtMs: number;
}

export interface ResolveInput<T> {
  /** The cache: its entry (possibly old), or it throws when it has none and the read failed. */
  cached: () => Promise<Stamped<T>>;
  /** A read made now, bypassing the cache. */
  readNow: () => Promise<Stamped<T>>;
  /** An entry older than this is read again now instead of shown. */
  maxAgeMs: number;
  /** The latest failure recorded for this key, for example by a background refresh. */
  lastFailure: () => FailedRead | null;
  /** The latest successful read made now (readNow) for this key, kept in this server process. */
  lastGoodRead: () => Stamped<T> | null;
  /** Keeps a successful read made now, with its own read time, for the next page view. */
  keepGoodRead: (entry: Stamped<T>) => void;
  now: () => number;
}

export async function resolveRead<T>(input: ResolveInput<T>): Promise<Read<T>> {
  let entry: Stamped<T> | null = null;
  let failure: FailedRead | null = null;
  try {
    entry = await input.cached();
  } catch (e) {
    failure = { reason: describeFailure(e), atMs: input.now() };
  }
  // The cache cannot be written from here, and while its own background refresh keeps
  // failing it keeps answering with its old entry. A read made now is kept beside it, so the
  // next page view uses that read (it is newer) instead of reading devnet again.
  const kept = input.lastGoodRead();
  if (entry && kept && kept.readAtMs > entry.readAtMs) entry = kept;
  let staleBecause: FailedRead | null = null;
  if (entry && input.now() - entry.readAtMs > input.maxAgeMs) {
    try {
      entry = await input.readNow();
      input.keepGoodRead(entry);
    } catch (e) {
      // The older entry is still the last good read; the page says this read failed.
      staleBecause = { reason: describeFailure(e), atMs: input.now() };
    }
  }
  if (!entry) {
    return { ok: false, ...(failure ?? { reason: "no read was made", atMs: input.now() }) };
  }
  if (!staleBecause) {
    // A read that failed after this entry was taken (the cache's background refresh in this
    // server process) makes the entry stale too.
    const known = input.lastFailure();
    if (known && known.atMs > entry.readAtMs) staleBecause = known;
  }
  return { ok: true, data: entry.data, readAtMs: entry.readAtMs, staleBecause };
}
