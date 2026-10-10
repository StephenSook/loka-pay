// Server-side reads for the judge pages, cached so a room of judges reloading never
// hammers devnet or GitHub. Server only (next/cache).
//
// The decoded result is cached together with the time it was read, with unstable_cache,
// rather than the raw HTTP responses with fetch's own cache: a page must show when a value
// was read, and a cached fetch response would carry no trustworthy read time. (The GitHub
// compare answer is also over 1 MB with its file patches and grows with every commit.)
//
// A failed read throws inside the cached function, so a failure is never cached: the next
// visitor tries again, and the page says the read failed and when.

import { unstable_cache } from "next/cache";
import { describeFailure } from "./solana";

export type Read<T> = { ok: true; data: T; readAtMs: number } | { ok: false; reason: string; atMs: number };

export async function cachedRead<T>(key: string, revalidateSeconds: number, read: () => Promise<T>): Promise<Read<T>> {
  const stamped = async () => ({ data: await read(), readAtMs: Date.now() });
  const fromCache = unstable_cache(stamped, [key], { revalidate: revalidateSeconds });
  let entry: { data: T; readAtMs: number } | null = null;
  let failure: unknown = null;
  try {
    entry = await fromCache();
  } catch (e) {
    failure = e;
  }
  // After a quiet spell the cache answers once with its last entry while it refreshes in
  // the background. When that entry is far older than the window, read now instead, so a
  // judge arriving at an idle site does not see an old value. If that read fails, the older
  // entry stays, with its own read time on the page.
  if (entry && Date.now() - entry.readAtMs > revalidateSeconds * 4 * 1000) {
    try {
      entry = await stamped();
    } catch {
      // keep the older entry
    }
  }
  if (entry) return { ok: true, data: entry.data, readAtMs: entry.readAtMs };
  return { ok: false, reason: describeFailure(failure), atMs: Date.now() };
}
