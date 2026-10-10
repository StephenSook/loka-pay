// Server-side reads for the judge pages, cached so a room of judges reloading never
// hammers devnet or GitHub. Server only (next/cache).
//
// The decoded result is cached together with the time it was read, with unstable_cache,
// rather than the raw HTTP responses with fetch's own cache: a page must show when a value
// was read, and a cached fetch response would carry no trustworthy read time. (The GitHub
// compare answer is also over 1 MB with its file patches and grows with every commit.)
//
// A failed read throws inside the cached function, so a failure is never cached: the next
// visitor tries again. When an earlier good read is still cached, the page gets it marked
// stale together with the failed read's reason and time (lib/read-state.ts), and says both.
//
// Every value says how old it is; only one younger than the policy's `currentForMs` is
// current, and only a current value may make a claim Live (a page asks with `needCurrent`).
// Every request upstream, from the cache or past it, goes through one ReadGate per server
// process (lib/read-state.ts): page views share a running read, each read has a budget per
// window, and a rate-limited answer pauses that read instead of being retried. So however
// many page views arrive, the reads they cause stay bounded, and a page that cannot read
// again shows the last good read with its age.

import { unstable_cache } from "next/cache";
import { ReadGate, ReadNotMade, resolveRead, type FailedRead, type GateLimits, type Read, type Stamped } from "./read-state";
import { describeFailure } from "./solana";

export type { FailedRead, Read } from "./read-state";

/** How one kind of read is cached, how young it must be to count as current, and its budget. */
export interface ReadPolicy {
  /** The cache's window: an entry older than this is read again (cached mode). */
  revalidateSeconds: number;
  /** A read younger than this is current: a claim may be Live from it. */
  currentForMs: number;
  limits: GateLimits;
}

export interface CachedReadOptions {
  /** For a page whose claims say Live: a current read (reused or made now), the cache only as a fallback. */
  needCurrent?: boolean;
}

const gate = new ReadGate(Date.now);

// The latest failed read per key in this server process. The cache refreshes an old entry
// in the background after answering with it; when that refresh fails, the cache keeps the
// old entry and says nothing, so the failure is recorded here for the next page to show.
const lastFailures = new Map<string, FailedRead>();

// The latest successful read made past the cache (readNow below) per key in this server
// process, with its own read time. unstable_cache cannot be written to directly, so while its
// background refresh keeps failing it would hand every page view its old entry and every view
// would read devnet again; this keeps the newer read for the next views instead.
const lastGoodReads = new Map<string, Stamped<unknown>>();

export async function cachedRead<T>(
  key: string,
  policy: ReadPolicy,
  read: () => Promise<T>,
  options: CachedReadOptions = {},
): Promise<Read<T>> {
  const upstream = async (): Promise<Stamped<T>> => {
    try {
      return await gate.read(key, policy.limits, read);
    } catch (e) {
      // A read the gate did not make is not a failure of devnet or GitHub.
      if (!(e instanceof ReadNotMade)) lastFailures.set(key, { reason: describeFailure(e), atMs: Date.now() });
      throw e;
    }
  };
  return resolveRead({
    cached: unstable_cache(upstream, [key], { revalidate: policy.revalidateSeconds }),
    readNow: upstream,
    // After a quiet spell the cache answers once with its last entry while it refreshes in
    // the background. When that entry is older than the window, read now instead, so a judge
    // arriving at an idle site never sees a value older than the window the page states.
    maxAgeMs: policy.revalidateSeconds * 1000,
    currentForMs: policy.currentForMs,
    lastFailure: () => lastFailures.get(key) ?? null,
    lastGoodRead: () => (lastGoodReads.get(key) as Stamped<T> | undefined) ?? null,
    keepGoodRead: (entry) => {
      lastGoodReads.set(key, entry);
    },
    now: Date.now,
    needCurrent: options.needCurrent ?? false,
  });
}
