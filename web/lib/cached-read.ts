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

import { unstable_cache } from "next/cache";
import { resolveRead, type FailedRead, type Read } from "./read-state";
import { describeFailure } from "./solana";

export type { FailedRead, Read } from "./read-state";

// The latest failed read per key in this server process. The cache refreshes an old entry
// in the background after answering with it; when that refresh fails, the cache keeps the
// old entry and says nothing, so the failure is recorded here for the next page to show.
const lastFailures = new Map<string, FailedRead>();

export async function cachedRead<T>(key: string, revalidateSeconds: number, read: () => Promise<T>): Promise<Read<T>> {
  const stamped = async () => {
    try {
      return { data: await read(), readAtMs: Date.now() };
    } catch (e) {
      lastFailures.set(key, { reason: describeFailure(e), atMs: Date.now() });
      throw e;
    }
  };
  return resolveRead({
    cached: unstable_cache(stamped, [key], { revalidate: revalidateSeconds }),
    readNow: stamped,
    // After a quiet spell the cache answers once with its last entry while it refreshes in
    // the background. When that entry is far older than the window, read now instead, so a
    // judge arriving at an idle site does not see an old value.
    maxAgeMs: revalidateSeconds * 4 * 1000,
    lastFailure: () => lastFailures.get(key) ?? null,
    now: Date.now,
  });
}
