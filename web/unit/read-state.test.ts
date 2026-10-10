import { expect, test } from "@playwright/test";
import { resolveRead, type FailedRead, type Stamped } from "../lib/read-state";

// lib/read-state.ts decides what a cached server read hands the page. A page must never
// show an older value as if it were current: when the newest read failed, the older value
// comes with that failure's reason and time, and a value reused from the cache says so
// (fresh: false) with the time the page asked, so the page can say how old it is.

const MAX_AGE = 120_000;
const NOW = 1_791_700_000_000;

function input(options: {
  cached: Stamped<string> | Error;
  readNow?: Stamped<string> | Error;
  lastFailure?: FailedRead | null;
  readFirst?: boolean;
}) {
  let readNowCalls = 0;
  return {
    calls: () => readNowCalls,
    value: {
      cached: async () => {
        if (options.cached instanceof Error) throw options.cached;
        return options.cached;
      },
      readNow: async () => {
        readNowCalls += 1;
        const r = options.readNow ?? new Error("readNow was not expected");
        if (r instanceof Error) throw r;
        return r;
      },
      maxAgeMs: MAX_AGE,
      lastFailure: () => options.lastFailure ?? null,
      lastGoodRead: () => null,
      keepGoodRead: () => {},
      now: () => NOW,
      readFirst: options.readFirst ?? false,
    },
  };
}

test("a recent cached entry is the latest read: no stale notice, no second read, and it says it is a cached read", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 10_000 } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 10_000, staleBecause: null, fresh: false, askedAtMs: NOW });
  expect(i.calls()).toBe(0);
});

test("an old entry whose fresh read FAILS is returned as stale, with the failure's reason and time", async () => {
  const i = input({
    cached: { data: "v1", readAtMs: NOW - 600_000 },
    readNow: new Error("no answer from api.devnet.solana.com within 8 s"),
  });
  const read = await resolveRead(i.value);
  expect(read).toEqual({
    ok: true,
    data: "v1",
    readAtMs: NOW - 600_000,
    staleBecause: { reason: "no answer from api.devnet.solana.com within 8 s", atMs: NOW },
    fresh: false,
    askedAtMs: NOW,
  });
  expect(i.calls()).toBe(1);
});

test("an old entry whose fresh read succeeds is replaced by it", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 600_000 }, readNow: { data: "v2", readAtMs: NOW } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v2", readAtMs: NOW, staleBecause: null, fresh: true, askedAtMs: NOW });
});

test("no cached entry and a failed read: a failure, never a value", async () => {
  const i = input({ cached: new Error("GitHub answered HTTP 502") });
  expect(await resolveRead(i.value)).toEqual({ ok: false, reason: "GitHub answered HTTP 502", atMs: NOW });
  expect(i.calls()).toBe(0);
});

test("a background refresh that failed after the entry was read makes the entry stale", async () => {
  const failure = { reason: "GitHub's limit for requests without a token is used up", atMs: NOW - 5_000 };
  const i = input({ cached: { data: "v1", readAtMs: NOW - 60_000 }, lastFailure: failure });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 60_000, staleBecause: failure, fresh: false, askedAtMs: NOW });
});

test("a failure older than the entry is history: the entry is current", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 10_000 }, lastFailure: { reason: "earlier outage", atMs: NOW - 90_000 } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 10_000, staleBecause: null, fresh: false, askedAtMs: NOW });
});

// The cache's background refresh keeps failing, so the cache keeps answering with its old
// entry. A fake clock moves time; reads made now are counted.
test.describe("a read made now is kept for the next page view", () => {
  function setup(cachedEntry: () => Stamped<string>) {
    const clock = { ms: NOW };
    let reads = 0;
    let kept: Stamped<string> | null = null;
    const value = {
      cached: async () => cachedEntry(),
      readNow: async () => {
        reads += 1;
        return { data: `read-now-${reads}`, readAtMs: clock.ms };
      },
      maxAgeMs: MAX_AGE,
      lastFailure: () => null,
      lastGoodRead: () => kept,
      keepGoodRead: (entry: Stamped<string>) => {
        kept = entry;
      },
      now: () => clock.ms,
    };
    return { clock, value, reads: () => reads };
  }

  test("past the window, the next views use the kept read instead of reading devnet again", async () => {
    const old = { data: "v1", readAtMs: NOW - 600_000 };
    const s = setup(() => old);
    expect(await resolveRead(s.value)).toEqual({ ok: true, data: "read-now-1", readAtMs: NOW, staleBecause: null, fresh: true, askedAtMs: NOW });
    expect(s.reads()).toBe(1);
    // Thirty seconds later the cache still answers with its old entry; the kept read is a
    // cached read for this view.
    s.clock.ms = NOW + 30_000;
    expect(await resolveRead(s.value)).toEqual({
      ok: true,
      data: "read-now-1",
      readAtMs: NOW,
      staleBecause: null,
      fresh: false,
      askedAtMs: NOW + 30_000,
    });
    s.clock.ms = NOW + MAX_AGE;
    expect(await resolveRead(s.value)).toEqual({
      ok: true,
      data: "read-now-1",
      readAtMs: NOW,
      staleBecause: null,
      fresh: false,
      askedAtMs: NOW + MAX_AGE,
    });
    expect(s.reads()).toBe(1);
    // Once the kept read is older than the window too, the next view reads again and keeps that.
    s.clock.ms = NOW + MAX_AGE + 1;
    expect(await resolveRead(s.value)).toEqual({
      ok: true,
      data: "read-now-2",
      readAtMs: NOW + MAX_AGE + 1,
      staleBecause: null,
      fresh: true,
      askedAtMs: NOW + MAX_AGE + 1,
    });
    expect(s.reads()).toBe(2);
  });

  test("a newer cache entry (its refresh succeeded) wins over an older kept read", async () => {
    let entry = { data: "v1", readAtMs: NOW - 600_000 };
    const s = setup(() => entry);
    await resolveRead(s.value);
    expect(s.reads()).toBe(1);
    s.clock.ms = NOW + 20_000;
    entry = { data: "v2-from-cache", readAtMs: NOW + 10_000 };
    expect(await resolveRead(s.value)).toEqual({
      ok: true,
      data: "v2-from-cache",
      readAtMs: NOW + 10_000,
      staleBecause: null,
      fresh: false,
      askedAtMs: NOW + 20_000,
    });
    expect(s.reads()).toBe(1);
  });
});

// A page whose claims say Live (/proof) asks for a read made for this page view: the cache is
// only the fallback when that read fails, and then the value is stale, never fresh.
test.describe("readFirst: a read made for this page, the cache only as a fallback", () => {
  test("reads now even when the cache holds an entry five seconds old", async () => {
    const i = input({ cached: { data: "cached", readAtMs: NOW - 5_000 }, readNow: { data: "now", readAtMs: NOW }, readFirst: true });
    expect(await resolveRead(i.value)).toEqual({ ok: true, data: "now", readAtMs: NOW, staleBecause: null, fresh: true, askedAtMs: NOW });
    expect(i.calls()).toBe(1);
  });

  test("a failed read returns the cached entry as stale, with the failure and its age, never fresh", async () => {
    const i = input({
      cached: { data: "cached", readAtMs: NOW - 60_000 },
      readNow: new Error("api.devnet.solana.com is rate limiting requests (HTTP 429)"),
      readFirst: true,
    });
    const read = await resolveRead(i.value);
    expect(read).toEqual({
      ok: true,
      data: "cached",
      readAtMs: NOW - 60_000,
      staleBecause: { reason: "api.devnet.solana.com is rate limiting requests (HTTP 429)", atMs: NOW },
      fresh: false,
      askedAtMs: NOW,
    });
    // One read for this page; the cached entry is not read again.
    expect(i.calls()).toBe(1);
  });

  test("a failed read with nothing cached is a failure, never a value", async () => {
    const i = input({ cached: new Error("could not reach api.devnet.solana.com"), readNow: new Error("could not reach api.devnet.solana.com"), readFirst: true });
    expect(await resolveRead(i.value)).toEqual({ ok: false, reason: "could not reach api.devnet.solana.com", atMs: NOW });
  });

  test("an entry the cache read after the failed read (it had none) is the latest read", async () => {
    const clock = { ms: NOW };
    const read = await resolveRead({
      cached: async () => ({ data: "cache-miss-read", readAtMs: (clock.ms += 50) }),
      readNow: async () => {
        clock.ms += 50;
        throw new Error("node is behind");
      },
      maxAgeMs: MAX_AGE,
      lastFailure: () => null,
      lastGoodRead: () => null,
      keepGoodRead: () => {},
      now: () => clock.ms,
      readFirst: true,
    });
    expect(read).toEqual({ ok: true, data: "cache-miss-read", readAtMs: NOW + 100, staleBecause: null, fresh: true, askedAtMs: NOW });
  });
});
