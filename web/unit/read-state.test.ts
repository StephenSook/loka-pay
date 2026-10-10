import { expect, test } from "@playwright/test";
import { resolveRead, type FailedRead, type Stamped } from "../lib/read-state";

// lib/read-state.ts decides what a cached server read hands the page. A page must never
// show an older value as if it were current: when the newest read failed, the older value
// comes with that failure's reason and time.

const MAX_AGE = 120_000;
const NOW = 1_791_700_000_000;

function input(options: {
  cached: Stamped<string> | Error;
  readNow?: Stamped<string> | Error;
  lastFailure?: FailedRead | null;
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
      now: () => NOW,
    },
  };
}

test("a recent cached entry is the latest read: no stale notice, no second read", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 10_000 } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 10_000, staleBecause: null });
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
  });
  expect(i.calls()).toBe(1);
});

test("an old entry whose fresh read succeeds is replaced by it", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 600_000 }, readNow: { data: "v2", readAtMs: NOW } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v2", readAtMs: NOW, staleBecause: null });
});

test("no cached entry and a failed read: a failure, never a value", async () => {
  const i = input({ cached: new Error("GitHub answered HTTP 502") });
  expect(await resolveRead(i.value)).toEqual({ ok: false, reason: "GitHub answered HTTP 502", atMs: NOW });
  expect(i.calls()).toBe(0);
});

test("a background refresh that failed after the entry was read makes the entry stale", async () => {
  const failure = { reason: "GitHub's limit for requests without a token is used up", atMs: NOW - 5_000 };
  const i = input({ cached: { data: "v1", readAtMs: NOW - 60_000 }, lastFailure: failure });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 60_000, staleBecause: failure });
});

test("a failure older than the entry is history: the entry is current", async () => {
  const i = input({ cached: { data: "v1", readAtMs: NOW - 10_000 }, lastFailure: { reason: "earlier outage", atMs: NOW - 90_000 } });
  expect(await resolveRead(i.value)).toEqual({ ok: true, data: "v1", readAtMs: NOW - 10_000, staleBecause: null });
});
