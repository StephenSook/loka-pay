// "Call me when it settles" (PLAN.md 3.9, web version): what the /call page and the server
// routes both need. Pure and client-safe: no environment, no network, no node: modules. The
// page and POST /api/call both decide which numbers may be called with isCallableUsNumber
// below, the one validator, so the two can never disagree (unit/call.test.ts checks both
// import it and that no other file carries a number pattern).

import { decodeBase58 } from "./base58";
import type { Row } from "./program-feed";

/** +1, an area code and an exchange that do not start with 0 or 1, and 4 more digits. */
const NANP_E164 = /^\+1([2-9]\d{2})([2-9]\d{2})\d{4}$/;

/**
 * NANP area codes that are not US geographic numbers. The demo calls US numbers only: a call
 * to another NANP country is billed as international, and some of these are well-known toll
 * fraud destinations. So Canada, the Caribbean and Atlantic NANP countries and the US
 * territories are refused, with toll-free, premium and other non-geographic codes. A list
 * like this can miss a new code, so the Vonage account's own destination limits and balance
 * stay the real bound.
 */
const NOT_US_GEOGRAPHIC = new Set([
  // Caribbean and Atlantic NANP countries.
  "242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829",
  "849", "868", "869", "876",
  // US territories (outside the demo's US-only scope).
  "340", "670", "671", "684", "787", "939",
  // Canada: geographic, then non-geographic.
  "204", "226", "236", "249", "250", "257", "263", "289", "306", "343", "354", "365", "367", "368", "382", "403", "416",
  "418", "428", "431", "437", "438", "450", "468", "474", "506", "514", "519", "548", "579", "581", "584", "587", "604",
  "613", "639", "647", "672", "683", "705", "709", "742", "753", "778", "780", "782", "807", "819", "825", "867", "873",
  "879", "902", "905", "942", "600", "622", "633", "644", "655", "677", "688",
  // Non-geographic and special: international inbound, personal services, carrier, US
  // government, toll-free (assigned and reserved), premium, and 976.
  "456", "500", "521", "522", "523", "524", "525", "526", "527", "528", "529", "533", "544", "566", "577", "588", "700",
  "710", "800", "822", "833", "844", "855", "866", "877", "880", "881", "882", "883", "884", "885", "886", "887", "888",
  "889", "900", "976",
]);

/** Exchanges that never reach a person's line: N11 service codes, carrier access and test codes, and the 976 premium exchange. */
const SPECIAL_EXCHANGE = /^([2-9]11|950|958|959|976)$/;

/**
 * True for a US geographic number in E.164 form that this demo may call. The fictional
 * 555-01xx numbers pass (tests use them, and no line answers them).
 */
export function isCallableUsNumber(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const m = value.match(NANP_E164);
  if (!m) return false;
  const [, area, exchange] = m;
  // N11 is never an area code; a 9 in the middle is held for NANP expansion; 37X and 96X are reserved.
  if (/^[2-9]11$/.test(area) || area[1] === "9" || /^(37|96)\d$/.test(area)) return false;
  return !NOT_US_GEOGRAPHIC.has(area) && !SPECIAL_EXCHANGE.test(exchange);
}

/**
 * What a visitor typed, as an E.164 number the demo may call, or null. Accepts spaces, dots,
 * dashes and parentheses, with or without the +1 or the 1. Nothing else is guessed.
 */
export function normalizeUsNumber(input: string): string | null {
  const compact = input.trim().replace(/[\s().-]/g, "");
  let e164: string;
  if (/^\+1\d{10}$/.test(compact)) e164 = compact;
  else if (/^1\d{10}$/.test(compact)) e164 = `+${compact}`;
  else if (/^\d{10}$/.test(compact)) e164 = `+1${compact}`;
  else return null;
  return isCallableUsNumber(e164) ? e164 : null;
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
  | "call_failed"
  | "wrong_code";

/** Which cap a rate-limited answer hit; "desk_code" is too many wrong desk codes from one client. */
export type RateLimitReason = "number" | "payment" | "site" | "desk_code";

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
