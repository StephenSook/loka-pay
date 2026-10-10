import { expect, test } from "@playwright/test";
import { ReadGate, ReadNotMade, resolveRead, shownAt, shownTogether, type FailedRead, type GateLimits, type Read, type ResolveInput, type Stamped } from "../lib/read-state";
import { RpcError } from "../lib/solana";

// lib/read-state.ts decides what a cached server read hands the page. A page must never
// show an older value as if it were current: every value carries its age (shownAtMs minus
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

const ok = (data: string, readAtMs: number, current: boolean, staleBecause: FailedRead | null = null, shownAtMs = NOW) => ({
  ok: true,
  data,
  readAtMs,
  staleBecause,
  current,
  shownAtMs,
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
  expect(read.ok && read.shownAtMs - read.readAtMs).toBe(30_000);
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
    expect(read.ok && read.shownAtMs - read.readAtMs).toBe(4_000);
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
    expect(read).toEqual(ok("cache-miss-read", NOW + 100, true, null, NOW + 100));
  });
});

// The age of a value is its age when the page shows it, never when the page asked: awaits
// between the two (a slow cache, a slow sibling read) make it older. A fake clock moves
// while the awaits run.
test.describe("age and current-ness are decided after the awaits, at render", () => {
  test("a kept read 9 s old, then a cache that takes 9 s to fail: 18 s old, not current, and the failure is kept", async () => {
    const clock = { ms: NOW };
    const read = await resolveRead<string>({
      cached: async () => {
        clock.ms += 9_000;
        throw new Error("no answer from 127.0.0.1 within 9 s");
      },
      readNow: async () => {
        throw new Error("readNow was not expected");
      },
      maxAgeMs: MAX_AGE,
      currentForMs: CURRENT_FOR,
      lastFailure: () => null,
      lastGoodRead: () => ({ data: "kept", readAtMs: NOW - 9_000 }),
      keepGoodRead: () => {},
      now: () => clock.ms,
    });
    expect(read).toEqual(ok("kept", NOW - 9_000, false, { reason: "no answer from 127.0.0.1 within 9 s", atMs: NOW + 9_000 }, NOW + 9_000));
    expect(read.ok && read.shownAtMs - read.readAtMs).toBe(18_000);
  });

  test("needCurrent: a slow failed read and a slow cache are both counted in the fallback's age", async () => {
    const clock = { ms: NOW };
    const read = await resolveRead<string>({
      cached: async () => {
        clock.ms += 4_000;
        throw new Error("nothing cached");
      },
      readNow: async () => {
        clock.ms += 5_000;
        throw new Error("node is behind");
      },
      maxAgeMs: MAX_AGE,
      currentForMs: CURRENT_FOR,
      reuseForMs: 7_000,
      lastFailure: () => null,
      lastGoodRead: () => ({ data: "kept", readAtMs: NOW - 8_000 }),
      keepGoodRead: () => {},
      now: () => clock.ms,
      needCurrent: true,
    });
    expect(read).toEqual(ok("kept", NOW - 8_000, false, { reason: "node is behind", atMs: NOW + 5_000 }, NOW + 9_000));
  });

  test("needCurrent reuses a kept read only while it has time to stay current through the render", async () => {
    const reused = input({ cached: new Error("not used"), kept: { data: "kept", readAtMs: NOW - 6_000 }, needCurrent: true });
    reused.value.reuseForMs = 7_000;
    expect(await resolveRead(reused.value)).toEqual(ok("kept", NOW - 6_000, true));
    expect(reused.calls()).toBe(0);
    const reread = input({ cached: new Error("not used"), kept: { data: "kept", readAtMs: NOW - 8_000 }, readNow: { data: "now", readAtMs: NOW }, needCurrent: true });
    reread.value.reuseForMs = 7_000;
    expect(await resolveRead(reread.value)).toEqual(ok("now", NOW, true));
    expect(reread.calls()).toBe(1);
  });

  test("a page re-stamps every read at one render time: a read current when handed over is not current 5 s later", () => {
    const handed: Read<string> = { ok: true, data: "v", readAtMs: NOW - 8_000, staleBecause: null, current: true, shownAtMs: NOW, currentForMs: CURRENT_FOR };
    expect(shownAt(handed, NOW + 5_000)).toEqual(ok("v", NOW - 8_000, false, null, NOW + 5_000));
    expect(shownAt(handed, NOW + 2_000)).toEqual(ok("v", NOW - 8_000, true, null, NOW + 2_000));
    // A newer read that failed keeps a value from being current, however young.
    const failure = { reason: "node is behind", atMs: NOW };
    const withFailure = shownAt({ ...handed, readAtMs: NOW - 1_000, staleBecause: failure }, NOW);
    expect(withFailure).toMatchObject({ current: false, staleBecause: failure });
    const failed: Read<string> = { ok: false, reason: "x", atMs: NOW };
    expect(shownAt(failed, NOW + 1)).toBe(failed);
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
    for (const read of reads) expect(read).toEqual(ok("slot 600000000", NOW + 300, true, null, NOW + 300));
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
      expect(read.ok && read.shownAtMs - read.readAtMs).toBe(at - (NOW - 20_000));
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

test("shownTogether stamps every read of a page with the same render time", () => {
  const a: Read<string> = { ok: true, data: "a", readAtMs: 1, staleBecause: null, current: true, shownAtMs: 1, currentForMs: CURRENT_FOR };
  const b: Read<number> = { ok: true, data: 2, readAtMs: 1, staleBecause: null, current: true, shownAtMs: 1, currentForMs: CURRENT_FOR };
  const [x, y] = shownTogether([a, b]);
  expect(x.ok && y.ok && x.shownAtMs === y.shownAtMs).toBe(true);
  expect(x.ok && x.shownAtMs).toBeGreaterThan(1);
  // Read at time 1, shown now: long past the window.
  expect(x.ok && x.current).toBe(false);
});

// A recent success followed by a newer failure (recorded by the cache's background refresh or
// another page's read) is not current: needCurrent does not reuse it, and if no new read
// succeeds the page shows the failure.
test.describe("a newer recorded failure outranks a recent kept success", () => {
  const recorded: FailedRead = { reason: "node is behind", atMs: NOW - 1_000 };

  test("4 s old success, then a failure, and no new read can be made: not current, showing the failure", async () => {
    const i = input({
      cached: new Error("nothing cached"),
      kept: { data: "kept", readAtMs: NOW - 4_000 },
      lastFailure: recorded,
      readNow: new ReadNotMade("this server already made 3 reads in the last 10 s, so it did not read again"),
      needCurrent: true,
    });
    const read = await resolveRead(i.value);
    expect(read).toEqual(ok("kept", NOW - 4_000, false, recorded));
    // It tried to read again instead of reusing the kept read.
    expect(i.calls()).toBe(1);
  });

  test("4 s old success, then a failure, then this page's own read fails: not current, showing that failure", async () => {
    const i = input({
      cached: new Error("nothing cached"),
      kept: { data: "kept", readAtMs: NOW - 4_000 },
      lastFailure: recorded,
      readNow: new Error("could not reach api.devnet.solana.com"),
      needCurrent: true,
    });
    expect(await resolveRead(i.value)).toEqual(ok("kept", NOW - 4_000, false, { reason: "could not reach api.devnet.solana.com", atMs: NOW }));
  });

  test("4 s old success, then a failure, then a new read succeeds: the new read, current", async () => {
    const i = input({ cached: new Error("not used"), kept: { data: "kept", readAtMs: NOW - 4_000 }, lastFailure: recorded, readNow: { data: "now", readAtMs: NOW }, needCurrent: true });
    expect(await resolveRead(i.value)).toEqual(ok("now", NOW, true));
  });

  test("a failure older than the kept success is history: the kept read is reused", async () => {
    const i = input({ cached: new Error("not used"), kept: { data: "kept", readAtMs: NOW - 4_000 }, lastFailure: { reason: "earlier", atMs: NOW - 9_000 }, needCurrent: true });
    expect(await resolveRead(i.value)).toEqual(ok("kept", NOW - 4_000, true));
    expect(i.calls()).toBe(0);
  });
});

// A read the gate held back sends nothing, so it says nothing about the source: a read still
// inside its window stays current, and only a failure since it (or its age) takes that away.
// The e2e run that found this: two /judge views missed the empty cache and the first /proof
// view read now, three GitHub reads in about a second; a /proof view 52 s later was past the
// 45 s reuse window, the budget (3 a minute) held its read back, and the 52 s old read on a
// 60 s window was shown as Not checked.
test.describe("a read the budget holds back leaves a read inside its window current", () => {
  const GITHUB: GateLimits = { reads: 3, perMs: 60_000, rateLimitPauseMs: 60_000 };

  function proofView(
    gate: ReadGate,
    clock: { ms: number },
    state: { cache: Stamped<string>; kept: Stamped<string> | null },
    upstream: () => Promise<string>,
    lastFailure: () => FailedRead | null = () => null,
  ) {
    return resolveRead<string>({
      // The cache's entry from the first /judge view; its own refresh is not due for 5 minutes.
      cached: async () => state.cache,
      readNow: () => gate.read("checks", GITHUB, upstream),
      maxAgeMs: 300_000,
      currentForMs: 60_000,
      reuseForMs: 45_000,
      lastFailure,
      lastGoodRead: () => state.kept,
      keepGoodRead: (entry) => {
        state.kept = entry;
      },
      now: () => clock.ms,
      needCurrent: true,
    });
  }

  /** Two /judge views that each missed the empty cache, then the first /proof view: three reads in a second. */
  async function spendTheBudget() {
    const clock = { ms: NOW };
    const gate = new ReadGate(() => clock.ms);
    const calls = { n: 0 };
    const upstream = async () => {
      calls.n += 1;
      return "checks";
    };
    const cache = await gate.read("checks", GITHUB, upstream);
    clock.ms = NOW + 400;
    await gate.read("checks", GITHUB, upstream);
    clock.ms = NOW + 1_000;
    const state = { cache, kept: null as Stamped<string> | null };
    const first = await proofView(gate, clock, state, upstream);
    expect(first).toMatchObject({ ok: true, readAtMs: NOW + 1_000, current: true });
    expect(calls.n).toBe(3);
    return { clock, gate, calls, upstream, state };
  }

  test("52 s later the budget holds the read back: the 52 s old read is still current, and nothing is sent", async () => {
    const { clock, gate, calls, upstream, state } = await spendTheBudget();
    clock.ms = NOW + 53_000;
    const read = await proofView(gate, clock, state, upstream);
    expect(read).toEqual({ ok: true, data: "checks", readAtMs: NOW + 1_000, staleBecause: null, current: true, shownAtMs: NOW + 53_000, currentForMs: 60_000 });
    expect(calls.n).toBe(3);
    // The budget really was spent at that moment: a fourth read is refused.
    await expect(gate.read("checks", GITHUB, upstream)).rejects.toBeInstanceOf(ReadNotMade);
  });

  test("the same view with a failure recorded since the kept read: not current, showing that failure", async () => {
    const { clock, gate, upstream, state } = await spendTheBudget();
    const failed: FailedRead = { reason: "GitHub did not answer within 10 s", atMs: NOW + 2_000 };
    clock.ms = NOW + 53_000;
    const read = await proofView(gate, clock, state, upstream, () => failed);
    expect(read).toEqual({ ok: true, data: "checks", readAtMs: NOW + 1_000, staleBecause: failed, current: false, shownAtMs: NOW + 53_000, currentForMs: 60_000 });
  });

  test("a held-back read with only a read past its window: not current, naming the read that was not made", async () => {
    const notMade = "this server already made 3 reads in the last 10 s, so it did not read again";
    const i = input({ cached: new Error("nothing cached"), kept: { data: "kept", readAtMs: NOW - 11_000 }, readNow: new ReadNotMade(notMade), needCurrent: true });
    expect(await resolveRead(i.value)).toEqual(ok("kept", NOW - 11_000, false, { reason: notMade, atMs: NOW, notMade: true }));
  });

  test("a failure recorded while the page waited for the cache counts: not current, showing it", async () => {
    const failures: { latest: FailedRead | null } = { latest: null };
    const failed: FailedRead = { reason: "node is behind", atMs: NOW };
    const read = await resolveRead<string>({
      cached: async () => {
        // The cache's own refresh fails while this page waits for it.
        failures.latest = failed;
        throw new Error("nothing cached");
      },
      readNow: async () => {
        throw new ReadNotMade("this server already made 3 reads in the last 10 s, so it did not read again");
      },
      maxAgeMs: MAX_AGE,
      currentForMs: CURRENT_FOR,
      reuseForMs: 7_000,
      lastFailure: () => failures.latest,
      lastGoodRead: () => ({ data: "kept", readAtMs: NOW - 8_000 }),
      keepGoodRead: () => {},
      now: () => NOW,
      needCurrent: true,
    });
    expect(read).toEqual(ok("kept", NOW - 8_000, false, failed));
  });
});
