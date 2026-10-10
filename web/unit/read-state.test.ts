import { expect, test } from "@playwright/test";
import { ReadGate, resolveRead, type FailedRead, type GateLimits, type ResolveInput, type Stamped } from "../lib/read-state";
import { RpcError } from "../lib/solana";

// lib/read-state.ts decides what a cached server read hands the page. A page must never
// show an older value as if it were current: every value carries its age (askedAtMs minus
// readAtMs), only a read younger than its window is current, and when the newest read failed
// the older value comes with that failure's reason and time.

const MAX_AGE = 120_000;
const CURRENT_FOR = 10_000;
const NOW = 1_791_700_000_000;

function input(options: {
  cached: Stamped<string> | Error;
  readNow?: Stamped<string> | Error;
  lastFailure?: FailedRead | null;
  kept?: Stamped<string> | null;
  needCurrent?: boolean;
}) {
  let readNowCalls = 0;
  const value: ResolveInput<string> = {
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
    currentForMs: CURRENT_FOR,
    lastFailure: () => options.lastFailure ?? null,
    lastGoodRead: () => options.kept ?? null,
    keepGoodRead: () => {},
    now: () => NOW,
    needCurrent: options.needCurrent ?? false,
  };
  return { calls: () => readNowCalls, value };
}

const ok = (data: string, readAtMs: number, current: boolean, staleBecause: FailedRead | null = null, askedAtMs = NOW) => ({
  ok: true,
  data,
  readAtMs,
  staleBecause,
  current,
  askedAtMs,
  currentForMs: CURRENT_FOR,
});

test("a cached entry younger than the window is current: no stale notice, no second read", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 5_000 } });
  expect(await resolveRead(i.value)).toEqual(ok("v1", NOW - 5_000, true));
  expect(i.calls()).toBe(0);
});

test("a cached entry older than its current window but inside the cache window is a cached read, with its age", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 30_000 } });
  const read = await resolveRead(i.value);
  expect(read).toEqual(ok("v1", NOW - 30_000, false));
  expect(read.ok && read.askedAtMs - read.readAtMs).toBe(30_000);
  expect(i.calls()).toBe(0);
});

test("an old entry whose fresh read FAILS is returned as stale, with the failure's reason and time", async () => {
  const i = input({
    cached: { data: "v1", readAtMs: NOW - 600_000 },
    readNow: new Error("no answer from api.devnet.solana.com within 8 s"),
  });
  expect(await resolveRead(i.value)).toEqual(
    ok("v1", NOW - 600_000, false, { reason: "no answer from api.devnet.solana.com within 8 s", atMs: NOW }),
  );
  expect(i.calls()).toBe(1);
});

test("an old entry whose fresh read succeeds is replaced by it", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 600_000 }, readNow: { data: "v2", readAtMs: NOW } });
  expect(await resolveRead(i.value)).toEqual(ok("v2", NOW, true));
});

test("no cached entry and a failed read: a failure, never a value", async () => {
  const i = input({ cached: new Error("GitHub answered HTTP 502") });
  expect(await resolveRead(i.value)).toEqual({ ok: false, reason: "GitHub answered HTTP 502", atMs: NOW });
  expect(i.calls()).toBe(0);
});

test("nothing in the cache but a kept earlier read: that read, as stale, with the failure", async () => {
  const i = input({ cached: new Error("GitHub answered HTTP 502"), kept: { data: "kept", readAtMs: NOW - 40_000 } });
  expect(await resolveRead(i.value)).toEqual(ok("kept", NOW - 40_000, false, { reason: "GitHub answered HTTP 502", atMs: NOW }));
});

test("a background refresh that failed after the entry was read makes the entry stale", async () => {
  const failure = { reason: "GitHub's limit for requests without a token is used up", atMs: NOW - 5_000 };
  const i = input({ cached: { data: "v1", readAtMs: NOW - 60_000 }, lastFailure: failure });
  expect(await resolveRead(i.value)).toEqual(ok("v1", NOW - 60_000, false, failure));
});

test("a failure older than the entry is history: no stale notice", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 30_000 }, lastFailure: { reason: "earlier outage", atMs: NOW - 90_000 } });
  expect(await resolveRead(i.value)).toEqual(ok("v1", NOW - 30_000, false));
});

// The cache's background refresh keeps failing, so the cache keeps answering with its old
// entry. A fake clock moves time; reads made now are counted.
test.describe("a read made now is kept for the next page view", () => {
  function setup(cachedEntry: () => Stamped<string>) {
    const clock = { ms: NOW };
    let reads = 0;
    let kept: Stamped<string> | null = null;
    const value: ResolveInput<string> = {
      cached: async () => cachedEntry(),
      readNow: async () => {
        reads += 1;
        return { data: `read-now-${reads}`, readAtMs: clock.ms };
      },
      maxAgeMs: MAX_AGE,
      currentForMs: CURRENT_FOR,
      lastFailure: () => null,
      lastGoodRead: () => kept,
      keepGoodRead: (entry: Stamped<string>) => {
        kept = entry;
      },
      now: () => clock.ms,
    };
    return { clock, value, reads: () => reads };
  }

  test("past the window, the next views use the kept read, with its age, instead of reading devnet again", async () => {
    const old = { data: "v1", readAtMs: NOW - 600_000 };
    const s = setup(() => old);
    expect(await resolveRead(s.value)).toEqual(ok("read-now-1", NOW, true));
    expect(s.reads()).toBe(1);
    // Thirty seconds later the cache still answers with its old entry; the kept read is a
    // cached read, 30 s old.
    s.clock.ms = NOW + 30_000;
    expect(await resolveRead(s.value)).toEqual(ok("read-now-1", NOW, false, null, NOW + 30_000));
    s.clock.ms = NOW + MAX_AGE;
    expect(await resolveRead(s.value)).toEqual(ok("read-now-1", NOW, false, null, NOW + MAX_AGE));
    expect(s.reads()).toBe(1);
    // Once the kept read is older than the window too, the next view reads again and keeps that.
    s.clock.ms = NOW + MAX_AGE + 1;
    expect(await resolveRead(s.value)).toEqual(ok("read-now-2", NOW + MAX_AGE + 1, true, null, NOW + MAX_AGE + 1));
    expect(s.reads()).toBe(2);
  });

  test("a newer cache entry (its refresh succeeded) wins over an older kept read", async () => {
    let entry = { data: "v1", readAtMs: NOW - 600_000 };
    const s = setup(() => entry);
    await resolveRead(s.value);
    expect(s.reads()).toBe(1);
    s.clock.ms = NOW + 20_000;
    entry = { data: "v2-from-cache", readAtMs: NOW + 15_000 };
    expect(await resolveRead(s.value)).toEqual(ok("v2-from-cache", NOW + 15_000, true, null, NOW + 20_000));
    expect(s.reads()).toBe(1);
  });
});

// A page whose claims say Live (/proof) needs a current read: a kept one younger than the
// window, else one made now. The cache is only the fallback, and then never current.
test.describe("needCurrent: a current read, the cache only as a fallback", () => {
  test("a kept read 4 s old is current: no read is made, and its exact age is known", async () => {
    const i = input({ cached: new Error("not used"), kept: { data: "kept", readAtMs: NOW - 4_000 }, needCurrent: true });
    const read = await resolveRead(i.value);
    expect(read).toEqual(ok("kept", NOW - 4_000, true));
    expect(read.ok && read.askedAtMs - read.readAtMs).toBe(4_000);
    expect(i.calls()).toBe(0);
  });

  test("a kept read older than the window is not reused: a read is made now", async () => {
    const i = input({
      cached: { data: "cached", readAtMs: NOW - 5_000 },
      kept: { data: "kept", readAtMs: NOW - 11_000 },
      readNow: { data: "now", readAtMs: NOW },
      needCurrent: true,
    });
    expect(await resolveRead(i.value)).toEqual(ok("now", NOW, true));
    expect(i.calls()).toBe(1);
  });

  test("a failed read returns the cached entry as stale, with the failure and its age, never current", async () => {
    const i = input({
      cached: { data: "cached", readAtMs: NOW - 60_000 },
      readNow: new Error("api.devnet.solana.com is rate limiting requests (HTTP 429)"),
      needCurrent: true,
    });
    expect(await resolveRead(i.value)).toEqual(
      ok("cached", NOW - 60_000, false, { reason: "api.devnet.solana.com is rate limiting requests (HTTP 429)", atMs: NOW }),
    );
    expect(i.calls()).toBe(1);
  });

  test("a failed read with nothing cached or kept is a failure, never a value", async () => {
    const i = input({ cached: new Error("could not reach api.devnet.solana.com"), readNow: new Error("could not reach api.devnet.solana.com"), needCurrent: true });
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
      currentForMs: CURRENT_FOR,
      lastFailure: () => null,
      lastGoodRead: () => null,
      keepGoodRead: () => {},
      now: () => clock.ms,
      needCurrent: true,
    });
    expect(read).toEqual(ok("cache-miss-read", NOW + 100, true));
  });
});

// The load bound: every upstream read goes through one ReadGate per server process. A fake
// clock; upstream reads are counted. TEST FIXTURES, no network.
test.describe("the read gate bounds upstream reads whatever the traffic", () => {
  const LIMITS: GateLimits = { reads: 3, perMs: 10_000, rateLimitPauseMs: 10_000 };

  function page(gate: ReadGate, clock: { ms: number }, upstream: () => Promise<string>, kept: { value: Stamped<string> | null }) {
    return resolveRead<string>({
      cached: async () => {
        throw new Error("nothing cached");
      },
      readNow: () => gate.read("facts", LIMITS, upstream),
      maxAgeMs: MAX_AGE,
      currentForMs: CURRENT_FOR,
      lastFailure: () => null,
      lastGoodRead: () => kept.value,
      keepGoodRead: (entry) => {
        kept.value = entry;
      },
      now: () => clock.ms,
      needCurrent: true,
    });
  }

  test("50 concurrent page views cause exactly one upstream read, and all 50 get its value", async () => {
    const clock = { ms: NOW };
    const gate = new ReadGate(() => clock.ms);
    const kept = { value: null as Stamped<string> | null };
    let upstreamCalls = 0;
    let answer: (value: string) => void = () => {};
    const upstream = () => {
      upstreamCalls += 1;
      return new Promise<string>((resolve) => {
        answer = resolve;
      });
    };
    const views = Array.from({ length: 50 }, () => page(gate, clock, upstream, kept));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upstreamCalls).toBe(1);
    clock.ms = NOW + 300;
    answer("slot 600000000");
    const reads = await Promise.all(views);
    expect(upstreamCalls).toBe(1);
    for (const read of reads) expect(read).toEqual(ok("slot 600000000", NOW + 300, true));
    // A view inside the current window reuses it: still one upstream read.
    clock.ms = NOW + 5_000;
    expect(await page(gate, clock, upstream, kept)).toEqual(ok("slot 600000000", NOW + 300, true, null, NOW + 5_000));
    expect(upstreamCalls).toBe(1);
  });

  test("a 429 answer is not retried: the next view sends nothing until the pause has passed, and says so", async () => {
    const clock = { ms: NOW };
    const gate = new ReadGate(() => clock.ms);
    const kept = { value: { data: "earlier", readAtMs: NOW - 20_000 } as Stamped<string> | null };
    let upstreamCalls = 0;
    const upstream = async () => {
      upstreamCalls += 1;
      throw new RpcError("http", "api.devnet.solana.com is rate limiting requests (HTTP 429)", 429);
    };
    const first = await page(gate, clock, upstream, kept);
    expect(upstreamCalls).toBe(1);
    expect(first).toEqual(ok("earlier", NOW - 20_000, false, { reason: "api.devnet.solana.com is rate limiting requests (HTTP 429)", atMs: NOW }));
    // Right away, and 9 s later: no request is sent; the last good read is shown with its age.
    for (const at of [NOW, NOW + 9_000]) {
      clock.ms = at;
      const read = await page(gate, clock, upstream, kept);
      expect(upstreamCalls).toBe(1);
      expect(read.ok && read.current).toBe(false);
      expect(read.ok && read.staleBecause?.notMade).toBe(true);
      expect(read.ok && read.staleBecause?.reason).toContain("the last read was rate limited");
      expect(read.ok && read.askedAtMs - read.readAtMs).toBe(at - (NOW - 20_000));
    }
    // After the pause, one more read is allowed.
    clock.ms = NOW + 10_000;
    await page(gate, clock, upstream, kept);
    expect(upstreamCalls).toBe(2);
  });

  test("failing reads stop at the budget: the 4th view in 10 s sends nothing and shows the last good read", async () => {
    const clock = { ms: NOW };
    const gate = new ReadGate(() => clock.ms);
    const kept = { value: { data: "earlier", readAtMs: NOW - 30_000 } as Stamped<string> | null };
    let upstreamCalls = 0;
    const upstream = async () => {
      upstreamCalls += 1;
      throw new RpcError("network", "could not reach api.devnet.solana.com");
    };
    for (let i = 0; i < 3; i += 1) {
      clock.ms = NOW + i * 1000;
      await page(gate, clock, upstream, kept);
    }
    expect(upstreamCalls).toBe(3);
    clock.ms = NOW + 3_000;
    const read = await page(gate, clock, upstream, kept);
    expect(upstreamCalls).toBe(3);
    expect(read.ok && read.data).toBe("earlier");
    expect(read.ok && read.staleBecause).toEqual({
      reason: "this server already made 3 reads in the last 10 s, so it did not read again",
      atMs: NOW + 3_000,
      notMade: true,
    });
    // Once the oldest read leaves the 10 s window, one more is allowed.
    clock.ms = NOW + 10_000;
    await page(gate, clock, upstream, kept);
    expect(upstreamCalls).toBe(4);
  });
});
