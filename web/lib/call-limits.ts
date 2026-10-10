// The phone call's caps (PLAN.md 3.9), kept in this server process's memory only. On a host
// that runs several instances, each instance counts on its own, so the site-wide cap is per
// instance, and a restart forgets every count. Nothing here is written to disk or logged.
//
// - per number: at most NUMBER_LIMIT calls in NUMBER_WINDOW_MS, keyed by the number's HMAC
//   (lib/call-crypto.ts numberKey), never the number itself;
// - per number and payment: one call, remembered for PAYMENT_MEMORY_MS;
// - site: at most SITE_LIMIT calls in SITE_WINDOW_MS.
// The clock is injected, so unit/call.test.ts drives it.

import type { RateLimitReason } from "./call-shared";

export const NUMBER_LIMIT = 2;
export const NUMBER_WINDOW_MS = 30 * 60_000;
export const PAYMENT_MEMORY_MS = 24 * 60 * 60_000;
export const SITE_LIMIT = 30;
export const SITE_WINDOW_MS = 60 * 60_000;

export type LimitCheck = { ok: true } | { ok: false; limit: RateLimitReason; retryAfterSeconds: number };

/** One reserved call, so a call the phone company refused can give its places back. */
export interface Reservation {
  key: string;
  signature: string;
  atMs: number;
}

const seconds = (ms: number) => Math.max(1, Math.ceil(ms / 1000));

export class CallLimits {
  private readonly byNumber = new Map<string, number[]>();
  private readonly byPayment = new Map<string, number>();
  private site: number[] = [];

  constructor(private readonly now: () => number = Date.now) {}

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

  private checkAt(key: string, signature: string | null, nowMs: number): LimitCheck {
    this.prune(nowMs);
    if (signature !== null) {
      const at = this.byPayment.get(`${key}:${signature}`);
      if (at !== undefined) return { ok: false, limit: "payment", retryAfterSeconds: seconds(at + PAYMENT_MEMORY_MS - nowMs) };
    }
    const times = this.byNumber.get(key) ?? [];
    if (times.length >= NUMBER_LIMIT) return { ok: false, limit: "number", retryAfterSeconds: seconds(times[0] + NUMBER_WINDOW_MS - nowMs) };
    if (this.site.length >= SITE_LIMIT) return { ok: false, limit: "site", retryAfterSeconds: seconds(this.site[0] + SITE_WINDOW_MS - nowMs) };
    return { ok: true };
  }

  /** The per-number and site caps, before the payment is known. Records nothing. */
  check(key: string): LimitCheck {
    return this.checkAt(key, null, this.now());
  }

  /** Every cap for this number and payment; when all allow it, the call is counted now. */
  reserve(key: string, signature: string): { ok: true; reservation: Reservation } | Extract<LimitCheck, { ok: false }> {
    const nowMs = this.now();
    const result = this.checkAt(key, signature, nowMs);
    if (!result.ok) return result;
    this.byNumber.set(key, [...(this.byNumber.get(key) ?? []), nowMs]);
    this.byPayment.set(`${key}:${signature}`, nowMs);
    this.site.push(nowMs);
    return { ok: true, reservation: { key, signature, atMs: nowMs } };
  }

  /** Gives a reservation's places back: only when the phone company answered that it placed no call. */
  release({ key, signature, atMs }: Reservation): void {
    const times = this.byNumber.get(key);
    if (times) {
      const i = times.indexOf(atMs);
      if (i >= 0) times.splice(i, 1);
      if (times.length === 0) this.byNumber.delete(key);
    }
    if (this.byPayment.get(`${key}:${signature}`) === atMs) this.byPayment.delete(`${key}:${signature}`);
    const i = this.site.indexOf(atMs);
    if (i >= 0) this.site.splice(i, 1);
  }
}
