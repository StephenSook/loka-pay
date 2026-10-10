// The phone call's caps (PLAN.md 3.9), kept in this server process's memory only.
//
// These are WEAK limits on a serverless host, and nothing should rely on them alone: every
// instance keeps its own counts, a new instance starts at zero, and a restart forgets them.
// The real bounds on calls are the Vonage account's balance and destination settings and the
// LOKA_CALLS_OFF kill switch (lib/call-server.ts). These caps only stop one instance from
// being used as a fast dialer. No database, on purpose.
//
// - per number: at most NUMBER_LIMIT accepted requests in NUMBER_WINDOW_MS, keyed by the
//   number's HMAC (lib/call-crypto.ts numberKey), never the number itself;
// - site (per instance): at most SITE_LIMIT accepted requests in SITE_WINDOW_MS;
// - per number and payment: one call, remembered for PAYMENT_MEMORY_MS.
// A request counts when it is taken, before any devnet read or upstream call, and it stays
// counted whatever happens next (a bad signature, no payment, a refused call), so a flood of
// failing requests runs into the caps like any other.
//
// Every map is bounded: entries expire with their window, and a map at its maximum size drops
// its oldest entry. With the site cap far below those maximums, nothing is dropped in
// practice; the bound only keeps memory finite. The clock is injected for unit/call.test.ts.

import type { RateLimitReason } from "./call-shared";

export const NUMBER_LIMIT = 2;
export const NUMBER_WINDOW_MS = 30 * 60_000;
export const PAYMENT_MEMORY_MS = 24 * 60 * 60_000;
export const SITE_LIMIT = 30;
export const SITE_WINDOW_MS = 60 * 60_000;
export const MAX_NUMBER_KEYS = 1000;
export const MAX_PAYMENT_PAIRS = 2000;

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
    for (const [key, times] of this.byNumber) {
      const kept = times.filter((t) => nowMs - t < NUMBER_WINDOW_MS);
      if (kept.length === 0) this.byNumber.delete(key);
      else this.byNumber.set(key, kept);
    }
    for (const [pair, at] of this.byPayment) {
      if (nowMs - at >= PAYMENT_MEMORY_MS) this.byPayment.delete(pair);
    }
  }

  private checkAt(key: string, nowMs: number): LimitCheck {
    this.prune(nowMs);
    const times = this.byNumber.get(key) ?? [];
    if (times.length >= this.settings.numberLimit) {
      return { ok: false, limit: "number", retryAfterSeconds: seconds(times[0] + NUMBER_WINDOW_MS - nowMs) };
    }
    if (this.site.length >= this.settings.siteLimit) {
      return { ok: false, limit: "site", retryAfterSeconds: seconds(this.site[0] + SITE_WINDOW_MS - nowMs) };
    }
    return { ok: true };
  }

  /** The per-number and site caps, without counting anything. */
  check(key: string): LimitCheck {
    return this.checkAt(key, this.now());
  }

  /** Counts one request for this number and for the site when both caps allow it. */
  take(key: string): LimitCheck {
    const nowMs = this.now();
    const result = this.checkAt(key, nowMs);
    if (!result.ok) return result;
    const times = this.byNumber.get(key);
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
