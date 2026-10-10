// "Call me when it settles" (PLAN.md 3.9, web version): what the /call page and the server
// routes both need. Pure and client-safe: no environment, no network, no node: modules, so the
// page can check a number before it sends it, and both sides refuse the same inputs.

import { decodeBase58 } from "./base58";
import type { Row } from "./program-feed";

/** A US or Canadian number in E.164 form: +1, an area code and an exchange that do not start with 0 or 1. */
export const NANP_NUMBER = /^\+1[2-9]\d{2}[2-9]\d{6}$/;

export function isNanpNumber(value: unknown): value is string {
  return typeof value === "string" && NANP_NUMBER.test(value);
}

/**
 * What a visitor typed, as an E.164 NANP number, or null. Accepts spaces, dots, dashes and
 * parentheses, with or without the +1 or the 1. Nothing else is guessed.
 */
export function normalizeUsNumber(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  let e164: string;
  if (/^\+1\d{10}$/.test(compact)) e164 = compact;
  else if (/^1\d{10}$/.test(compact)) e164 = `+${compact}`;
  else if (/^\d{10}$/.test(compact)) e164 = `+1${compact}`;
  else return null;
  return isNanpNumber(e164) ? e164 : null;
}

export const CALL_LANGS = ["en", "fr"] as const;
export type CallLang = (typeof CALL_LANGS)[number];

export function isCallLang(value: unknown): value is CallLang {
  return typeof value === "string" && (CALL_LANGS as readonly string[]).includes(value);
}

/** A Solana transaction signature: base58 of 64 bytes (86 to 88 characters in practice). */
export function isPlausibleSignature(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 64 || value.length > 90) return false;
  try {
    return decodeBase58(value).length === 64;
  } catch {
    return false;
  }
}

/** The error codes POST /api/call answers with (each with its HTTP status in lib/call-server.ts). */
export type CallErrorCode =
  | "calls_off"
  | "bad_request"
  | "bad_number"
  | "bad_lang"
  | "bad_signature"
  | "no_settled_payment"
  | "too_old"
  | "rate_limited"
  | "chain_read_failed"
  | "call_failed";

/** Which cap a rate-limited answer hit. */
export type RateLimitReason = "number" | "payment" | "site";

export interface CalledPayment {
  signature: string;
  /** Mint base units (devnet USDC, 6 decimals) as a decimal string. */
  amountUnits: string;
  settledAtMs: number;
  explorer: string;
}

export type CallAnswer =
  | { status: "calling"; payment: CalledPayment }
  | { error: CallErrorCode; reason?: string; retryAfterSeconds?: number; limit?: RateLimitReason };

/** Only a payment settled at most this long ago is called about when the page names it. */
export const SIGNATURE_MAX_AGE_MS = 15 * 60_000;

/**
 * True for a /live feed row the armed /call page should call about: a redeem_note that devnet
 * says succeeded, with an amount, read in full (getTransaction), and new since the page armed.
 * New means it arrived over the WebSocket, or it came in a later history read and was not in
 * the first one (`before`, null until that read succeeds). The server checks it again.
 */
export function isNewSettlement(row: Row, before: ReadonlySet<string> | null): boolean {
  if (row.details !== "read" || row.result !== "succeeded") return false;
  if (!row.actions.includes("redeem_note") || row.amounts.length === 0) return false;
  if (row.arrivedLive) return true;
  return before !== null && !before.has(row.signature);
}
