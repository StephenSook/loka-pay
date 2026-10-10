// The phone call's caps (PLAN.md 3.9), kept in this server process's memory only.
//
// These are WEAK limits on a serverless host, and nothing should rely on them alone: every
// instance keeps its own counts, a new instance starts at zero, and a restart forgets them.
// The real bounds on calls are the desk code (LOKA_CALL_CODE), the Vonage account's balance
// and destination settings, and the LOKA_CALLS_OFF kill switch (lib/call-server.ts). These
// caps only stop one instance from being used as a fast dialer. No database, on purpose.
//
// CallLimits, for requests that passed every check including the desk code. Such a request
// reserves a slot in both caps below before any devnet read or upstream call, and the slots
// stay reserved whatever happens next (a bad signature, too old, no payment, a devnet error, a
// call Vonage refused), so a desk-code holder flooding bad requests still runs into the caps.
// A request refused before that step (bad body, calls off, wrong code) reserves nothing.
// - per number: at most NUMBER_LIMIT requests in NUMBER_WINDOW_MS, keyed by the number's HMAC
//   (lib/call-crypto.ts numberKey), never the number itself;
// - site (per instance): at most SITE_LIMIT requests in SITE_WINDOW_MS;
// - per number and payment: one call, remembered for PAYMENT_MEMORY_MS.
//
// DeskCodeFailures, for wrong or missing desk codes, which never touch the caps above (so
// nobody can lock judges out by sending bad codes), and which a correct code never meets
// (lib/call-server.ts compares the code first): at most FAILURE_LIMIT failures in
// FAILURE_WINDOW_MS per client, keyed by HMAC-SHA256(a random secret made when the server
// starts, the client's address), never the address itself. The address comes from Vercel's
// x-vercel-forwarded-for, then x-real-ip, never the client-writable x-forwarded-for; a
// deployed request with neither is refused (lib/call-server.ts clientKey). Clients behind one
// address share a key, so the limit is loose enough for typos at a venue.
//
// Every map is bounded: entries expire with their window, and a map at its maximum size drops
// its oldest entry. With the caps far below those maximums, nothing is dropped in practice;
// the bound only keeps memory finite. The clock is injected for unit/call.test.ts.

import type { RateLimitReason } from "./call-shared";

export const NUMBER_LIMIT = 2;
export const NUMBER_WINDOW_MS = 30 * 60_000;
export const PAYMENT_MEMORY_MS = 24 * 60 * 60_000;
export const SITE_LIMIT = 30;
export const SITE_WINDOW_MS = 60 * 60_000;
export const MAX_NUMBER_KEYS = 1000;
export const MAX_PAYMENT_PAIRS = 2000;
export const FAILURE_LIMIT = 10;
export const FAILURE_WINDOW_MS = 10 * 60_000;
export const MAX_CLIENT_KEYS = 2000;

export interface LimitSettings {
  numberLimit: number;
  siteLimit: number;
  maxNumberKeys: number;
  maxPaymentPairs: number;
}

export type LimitCheck = { ok: true } | { ok: false; limit: RateLimitReason; retryAfterSeconds: number };

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

/** Drops a map's oldest entries (insertion order) until it has room for one more. */
function makeRoom<V>(map: Map<string, V>, max: number): void {
  while (map.size >= max) map.delete(map.keys().next().value as string);
}

/** Keeps only the times inside the window for each key; a key with none left is removed. */
function pruneTimes(map: Map<string, number[]>, nowMs: number, windowMs: number): void {
  for (const [key, times] of map) {
    const kept = times.filter((t) => nowMs - t < windowMs);
    if (kept.length === 0) map.delete(key);
    else map.set(key, kept);
  }
}

export class CallLimits {
  private readonly byNumber = new Map<string, number[]>();
  private readonly byPayment = new Map<string, number>();
  private site: number[] = [];
  private readonly settings: LimitSettings;

  constructor(
    private readonly now: () => number = Date.now,
    settings: Partial<LimitSettings> = {},
  ) {
    this.settings = {
      numberLimit: NUMBER_LIMIT,
      siteLimit: SITE_LIMIT,
      maxNumberKeys: MAX_NUMBER_KEYS,
      maxPaymentPairs: MAX_PAYMENT_PAIRS,
      ...settings,
    };
  }

  private prune(nowMs: number): void {
    this.site = this.site.filter((t) => nowMs - t < SITE_WINDOW_MS);
    pruneTimes(this.byNumber, nowMs, NUMBER_WINDOW_MS);
    for (const [pair, at] of this.byPayment) {
      if (nowMs - at >= PAYMENT_MEMORY_MS) this.byPayment.delete(pair);
    }
  }

  /**
   * Reserves one slot for this number and one for the site, together: both when both caps
   * allow it, neither otherwise. Called before any devnet read or upstream call; the slots
   * stay reserved whatever happens next.
   */
  reserve(key: string): LimitCheck {
    const nowMs = this.now();
    this.prune(nowMs);
    const times = this.byNumber.get(key);
    if (times && times.length >= this.settings.numberLimit) {
      return { ok: false, limit: "number", retryAfterSeconds: seconds(times[0] + NUMBER_WINDOW_MS - nowMs) };
    }
    if (this.site.length >= this.settings.siteLimit) {
      return { ok: false, limit: "site", retryAfterSeconds: seconds(this.site[0] + SITE_WINDOW_MS - nowMs) };
    }
    if (times) {
      times.push(nowMs);
    } else {
      makeRoom(this.byNumber, this.settings.maxNumberKeys);
      this.byNumber.set(key, [nowMs]);
    }
    this.site.push(nowMs);
    return { ok: true };
  }

  /** One call per number and payment: records the pair, or says when it may be called about again. */
  claimPayment(key: string, signature: string): LimitCheck {
    const nowMs = this.now();
    this.prune(nowMs);
    // A number key is 64 hex characters and a signature is base58, so ":" cannot be ambiguous.
    const pair = `${key}:${signature}`;
    const at = this.byPayment.get(pair);
    if (at !== undefined) return { ok: false, limit: "payment", retryAfterSeconds: seconds(at + PAYMENT_MEMORY_MS - nowMs) };
    makeRoom(this.byPayment, this.settings.maxPaymentPairs);
    this.byPayment.set(pair, nowMs);
    return { ok: true };
  }

  /** How many entries each map holds, for the tests that check the bounds. */
  sizes(): { numbers: number; payments: number; site: number } {
    return { numbers: this.byNumber.size, payments: this.byPayment.size, site: this.site.length };
  }
}

export class DeskCodeFailures {
  private readonly byClient = new Map<string, number[]>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly limit: number = FAILURE_LIMIT,
    private readonly maxClients: number = MAX_CLIENT_KEYS,
  ) {}

  /** Refused when this client has had `limit` failures inside the window. Counts nothing. */
  check(clientKey: string): LimitCheck {
    const nowMs = this.now();
    pruneTimes(this.byClient, nowMs, FAILURE_WINDOW_MS);
    const times = this.byClient.get(clientKey);
    if (times && times.length >= this.limit) {
      return { ok: false, limit: "desk_code", retryAfterSeconds: seconds(times[0] + FAILURE_WINDOW_MS - nowMs) };
    }
    return { ok: true };
  }

  /** Counts one wrong or missing desk code for this client. */
  record(clientKey: string): void {
    const nowMs = this.now();
    const times = this.byClient.get(clientKey);
    if (times) {
      times.push(nowMs);
    } else {
      makeRoom(this.byClient, this.maxClients);
      this.byClient.set(clientKey, [nowMs]);
    }
  }

  get size(): number {
    return this.byClient.size;
  }
}
