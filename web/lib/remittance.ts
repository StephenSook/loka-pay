// /send (PLAN.md 3.3, web half): the form's input rules, the request, every answer of
// POST /v1/remittances (protocol/API-V1.md section 9, server/src/remit/remittance.ts),
// the pending repost loop, and the check of the allowance certificate the server returns.
//
// Pure: no framework. The network, the clock and sleeping are passed in, so
// unit/remittance.test.ts runs every path, the 30 s pending bound included, with a fake clock.
// Runs in the browser (components/send-form.tsx); nothing here reads the environment.
//
// Answers are told apart by their status and their `error` NAME, never by their message text.

import {
  PaymentError,
  base64urlDecode,
  displayAmount,
  encodeTransport,
  fromHex,
  parseAmount,
  toHex,
  verifyAllowWire,
  type Deployment,
  type PaymentErrorCode,
} from "@lokapay/protocol";
import { decodeBase58 } from "./base58";
import type { SerializedDeployment } from "./receipt";

// ---------- the form ----------

/** The most one send may fund: one sandbox USDC (6 decimals), API-V1 section 9. */
export const MAX_SEND_UNITS = "1000000";
const MAX_UNITS = BigInt(MAX_SEND_UNITS);
const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

/**
 * The payer phone's allowance id code, docs/ALLOWANCE-ID-QR.md (`AllowanceIdCode` in the iOS package):
 * `LOKA-ALLOWANCE:<id>`, the prefix exact and case-sensitive.
 */
export const ALLOWANCE_CODE_PREFIX = "LOKA-ALLOWANCE:";

export type Parsed<T, C extends string = string> = { ok: true; value: T } | { ok: false; code: C; problem: string };

export type RecipientProblem = "empty" | "no_id" | "prefix_case" | "sign" | "not_digits" | "leading_zero" | "too_large";

const RECIPIENT_PROBLEMS: Record<RecipientProblem, string> = {
  empty: "Enter the payer phone's allowance id.",
  no_id: "The code has no allowance id after LOKA-ALLOWANCE:.",
  prefix_case: "The code must start with LOKA-ALLOWANCE: in capital letters.",
  sign: "An allowance id has no plus or minus sign.",
  not_digits: "An allowance id is the digits 0 to 9 only, with no spaces or separators.",
  leading_zero: "An allowance id has no leading zeros.",
  too_large: "That number is larger than any allowance id (at most 18446744073709551615).",
};

const refuse = (code: RecipientProblem): Parsed<string, RecipientProblem> => ({ ok: false, code, problem: RECIPIENT_PROBLEMS[code] });

/**
 * The recipient allowance id, exactly as docs/ALLOWANCE-ID-QR.md defines it: the phone's code
 * `LOKA-ALLOWANCE:<id>` or the bare id the phone shows as large text, with whitespace around the
 * whole text ignored. `<id>` is a canonical decimal u64: digits only, no sign, no leading zero
 * except "0" itself, at most 18446744073709551615. Anything else is refused by name and never
 * sent to the API.
 */
export function parseRecipient(input: string): Parsed<string, RecipientProblem> {
  const text = input.trim();
  if (text === "") return refuse("empty");
  let id = text;
  if (text.startsWith(ALLOWANCE_CODE_PREFIX)) {
    id = text.slice(ALLOWANCE_CODE_PREFIX.length);
    if (id === "") return refuse("no_id");
  } else if (text.toUpperCase().startsWith(ALLOWANCE_CODE_PREFIX)) {
    return refuse("prefix_case");
  }
  if (/^[+-]/.test(id)) return refuse("sign");
  if (!/^[0-9]+$/.test(id)) return refuse("not_digits");
  if (id.length > 1 && id.startsWith("0")) return refuse("leading_zero");
  if (id.length > 20 || BigInt(id) > U64_MAX) return refuse("too_large");
  return { ok: true, value: id };
}

/**
 * The amount in sandbox USDC ("1", "1.00", "0.25", "$0.50"), at most 6 decimals, more than 0
 * and at most 1.00. Returns base units as a decimal string ("1000000").
 */
export function parseSendAmount(input: string): Parsed<string, "empty" | "format" | "zero" | "over_cap"> {
  let text = input.trim();
  if (text.startsWith("$")) text = text.slice(1).trim();
  if (text.startsWith(".")) text = `0${text}`;
  if (text === "") return { ok: false, code: "empty", problem: "Enter an amount, at most 1.00." };
  const units = parseAmount(text);
  if (units === null) return { ok: false, code: "format", problem: "Enter an amount like 1.00 or 0.25, with at most 6 decimals." };
  if (units === BigInt(0)) return { ok: false, code: "zero", problem: "The amount must be more than 0." };
  if (units > MAX_UNITS) return { ok: false, code: "over_cap", problem: "A send is at most 1.00 sandbox USDC." };
  return { ok: true, value: units.toString() };
}

export interface RemittanceRequest {
  recipientAllowanceId: string;
  amountUnits: string;
}

/** The exact JSON the server accepts: these two fields and nothing else (API-V1 section 9). */
export function requestBody(request: RemittanceRequest): string {
  return JSON.stringify({ recipientAllowanceId: request.recipientAllowanceId, amountUnits: request.amountUnits });
}

export const REMITTANCE_PATH = "/v1/remittances";

// ---------- answers ----------

/** What one POST produced: an HTTP answer, or no answer at all. */
export type PostResult =
  | { kind: "answer"; status: number; body: unknown; retryAfterSeconds: number | null }
  | { kind: "network"; reason: string }
  | { kind: "timeout"; seconds: number };

export interface RemittanceSuccess {
  recipientAllowanceId: string;
  allowanceId: string;
  /** The allowance wire (PAYMENT-V1 section 4.5), decoded from `allow`. */
  allowBytes: Uint8Array;
  earmarks: string[];
  signature: string;
}

/** The refusals the server names, each with what the page says and whether resending the same request can help. */
export const REFUSALS = {
  amount_cap: {
    message: "The server refused the amount as over its limit for one send, which is never more than 1.00 sandbox USDC and can be lower.",
    retryable: false,
  },
  unknown_allowance: {
    message: "No allowance with that id exists on devnet. Check the id on the payer phone and try again.",
    retryable: false,
  },
  budget_exhausted: {
    message: "The server's sandbox send wallet has used its budget for today (days are UTC). Sending works again tomorrow.",
    retryable: false,
  },
  rate_limited: { message: "Too many sends from this network. Try again later.", retryable: false },
  chain_unavailable: {
    message: "The server could not reach devnet. Nothing was signed, so it is safe to try again.",
    retryable: true,
  },
  bad_json: { message: "The server could not read the request.", retryable: false },
  internal_error: { message: "The server hit an internal error.", retryable: true },
} as const;

export type RefusalName = keyof typeof REFUSALS;

export type Outcome =
  | { kind: "success"; created: boolean; success: RemittanceSuccess }
  | { kind: "pending"; signature: string | null; retryAfterSeconds: number }
  /** Still pending when the bound ran out: the same request can be sent again to check. */
  | { kind: "still_pending"; signature: string | null }
  /** 409 remittance_failed: the funding transaction failed on chain; no certificate. */
  | { kind: "failed_on_chain"; signature: string | null }
  | { kind: "refused"; error: RefusalName; retryAfterSeconds: number | null }
  /** 404 unknown_route: the server does not run POST /v1/remittances. */
  | { kind: "server_off" }
  | { kind: "unexpected"; status: number; detail: string }
  | { kind: "network"; reason: string }
  | { kind: "timeout"; seconds: number }
  /** The page asked the loop to stop (the visitor left): no further request was sent. */
  | { kind: "stopped" };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function isU64Decimal(v: unknown): v is string {
  return typeof v === "string" && /^(0|[1-9][0-9]{0,19})$/.test(v) && BigInt(v) <= U64_MAX;
}

/** A Solana transaction signature: base58 of 64 bytes. */
export function isTxSignature(v: unknown): v is string {
  if (typeof v !== "string" || v.length > 100) return false;
  try {
    return decodeBase58(v).length === 64;
  } catch {
    return false;
  }
}

function errorName(body: unknown): string | null {
  return isObject(body) && typeof body.error === "string" ? body.error : null;
}

function parseSuccess(body: unknown, request: RemittanceRequest): RemittanceSuccess | string {
  if (!isObject(body)) return "the answer was not a JSON object";
  if (body.recipientAllowanceId !== request.recipientAllowanceId) return "the answer names a different recipient allowance";
  if (!isU64Decimal(body.allowanceId)) return "the new allowance id is not a u64";
  if (typeof body.allow !== "string") return "the answer has no allowance certificate";
  let allowBytes: Uint8Array;
  try {
    allowBytes = base64urlDecode(body.allow);
  } catch {
    return "the allowance certificate is not canonical base64url";
  }
  if (!Array.isArray(body.earmarks) || !body.earmarks.every((e) => typeof e === "string" && /^[0-9a-f]{64}$/.test(e))) {
    return "the earmarks are not a list of key hashes";
  }
  if (!isTxSignature(body.signature)) return "the transaction signature is not base58 of 64 bytes";
  if (body.sandbox !== true) return "the answer does not say sandbox";
  return {
    recipientAllowanceId: body.recipientAllowanceId,
    allowanceId: body.allowanceId,
    allowBytes,
    earmarks: body.earmarks as string[],
    signature: body.signature,
  };
}

/** One HTTP answer, by status and error name. */
export function classifyAnswer(
  answer: { status: number; body: unknown; retryAfterSeconds: number | null },
  request: RemittanceRequest,
): Outcome {
  const { status, body } = answer;
  if (status === 200 || status === 201) {
    const parsed = parseSuccess(body, request);
    if (typeof parsed === "string") return { kind: "unexpected", status, detail: parsed };
    return { kind: "success", created: status === 201, success: parsed };
  }
  if (status === 202) {
    if (!isObject(body) || body.status !== "pending") return { kind: "unexpected", status, detail: "a 202 answer that does not say pending" };
    const signature = body.signature === null || body.signature === undefined ? null : body.signature;
    if (signature !== null && !isTxSignature(signature)) return { kind: "unexpected", status, detail: "the pending transaction signature is not base58 of 64 bytes" };
    const retry = typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter) ? body.retryAfter : 2;
    return { kind: "pending", signature, retryAfterSeconds: retry };
  }
  const name = errorName(body);
  if (name === "remittance_failed") {
    const signature = isObject(body) && isTxSignature(body.signature) ? body.signature : null;
    return { kind: "failed_on_chain", signature };
  }
  if (name === "unknown_route" && status === 404) return { kind: "server_off" };
  if (name !== null && Object.prototype.hasOwnProperty.call(REFUSALS, name)) {
    return { kind: "refused", error: name as RefusalName, retryAfterSeconds: answer.retryAfterSeconds };
  }
  return { kind: "unexpected", status, detail: name ? `error "${name}"` : "no error name in the answer" };
}

// ---------- the pending loop ----------

/**
 * No repost STARTS later than this after the first request; then the page stops and offers to
 * check again. Each request may still wait up to POST_TIMEOUT_MS for its answer.
 */
export const PENDING_BOUND_MS = 30_000;

/** The wait before reposting, in whole seconds: the server's retryAfter, held to 1 to 10 (API-V1 section 5). */
export function repostDelaySeconds(retryAfter: number): number {
  return Math.min(10, Math.max(1, Math.ceil(retryAfter)));
}

export interface LoopDeps {
  post: (body: string) => Promise<PostResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  boundMs?: number;
  /** Called with each pending answer before the wait, so the page can say so. */
  onPending?: (pending: Extract<Outcome, { kind: "pending" }>, waitSeconds: number) => void;
  /** Checked after each wait, before a repost: true ends the loop with no further request. */
  stopped?: () => boolean;
}

export type FinalOutcome = Exclude<Outcome, { kind: "pending" }>;

/**
 * Sends the request, and while the server answers 202 pending, waits its retryAfter and sends the
 * SAME request again (there is no GET for a send). Stops with still_pending when the next repost
 * would start past the bound, so the page never waits forever, and with stopped when the page
 * says so (the visitor left), so no request is sent for a page nobody is looking at.
 */
export async function sendRemittance(request: RemittanceRequest, deps: LoopDeps): Promise<FinalOutcome> {
  const body = requestBody(request);
  const bound = deps.boundMs ?? PENDING_BOUND_MS;
  const start = deps.now();
  for (;;) {
    const result = await deps.post(body);
    if (result.kind === "network") return result;
    if (result.kind === "timeout") return result;
    const outcome = classifyAnswer(result, request);
    if (outcome.kind !== "pending") return outcome;
    const wait = repostDelaySeconds(outcome.retryAfterSeconds);
    if (deps.now() + wait * 1000 - start > bound) return { kind: "still_pending", signature: outcome.signature };
    deps.onPending?.(outcome, wait);
    await deps.sleep(wait * 1000);
    if (deps.stopped?.()) return { kind: "stopped" };
  }
}

/** Retry-After as whole seconds when it is a number of seconds; null otherwise. */
export function parseRetryAfter(value: string | null): number | null {
  if (value === null || !/^[0-9]{1,7}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/** Per POST: the server signs, sends and waits for devnet inside the request. */
export const POST_TIMEOUT_MS = 20_000;

/**
 * POST from the browser: only the Content-Type header (the server's CORS allows no other), no
 * credentials, no cache. A cross-origin answer usually hides Retry-After; then it reads null.
 */
export function browserPost(url: string, timeoutMs = POST_TIMEOUT_MS): (body: string) => Promise<PostResult> {
  return async (body) => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        credentials: "omit",
        cache: "no-store",
        mode: "cors",
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : "";
      if (name === "TimeoutError" || name === "AbortError") return { kind: "timeout", seconds: timeoutMs / 1000 };
      return { kind: "network", reason: `could not reach ${new URL(url).host}` };
    }
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      // Not JSON: classifyAnswer names the status.
    }
    return { kind: "answer", status: response.status, body: parsed, retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) };
  };
}

// ---------- the certificate ----------

export interface CertificateView {
  allowanceId: string;
  payerKeyHashHex: string;
  capUnits: string;
  offlineLimitUnits: string;
  /** Unix seconds. */
  expiry: string;
  earmarks: string[];
  bondUnits: string;
}

export type Verification = { verified: true; certificate: CertificateView } | { verified: false; reason: string };

const CERT_ERROR_WORDS: Partial<Record<PaymentErrorCode, string>> = {
  length: "the certificate is too short",
  bad_signature: "its signature does not match the server key",
  prefix: "it is not an allowance certificate",
  wrong_program: "it names a different program",
  cluster: "it names a different cluster",
  wrong_mint: "it names a different mint",
  earmark_mismatch: "its earmark list does not match the hash it signs",
  earmark_list: "its earmark list is malformed",
  base64url: "it is not canonical base64url",
};

/** A serialized deployment back to bytes for the protocol library. */
export function toDeployment(d: SerializedDeployment): Deployment {
  return { programId: fromHex(d.programIdHex), clusterId: d.clusterId, mint: fromHex(d.mintHex) };
}

/**
 * Checks the returned certificate with the protocol library (signature with the server key,
 * program, cluster, mint, earmark hash), then that it is the allowance the answer names, with
 * the earmarks the answer lists, and that it has not expired at `nowSeconds` (the phone refuses an
 * expired one with import_expired, docs/ALLOWANCE-ID-QR.md). Only a verified certificate is drawn
 * as a code. The payer key hash is shown, not checked: only the phone knows its own key.
 */
export function verifyCertificate(success: RemittanceSuccess, deployment: SerializedDeployment, nowSeconds: number): Verification {
  let fields;
  try {
    fields = verifyAllowWire(success.allowBytes, toDeployment(deployment), fromHex(deployment.serverPublicKeyHex));
  } catch (e) {
    const code = e instanceof PaymentError ? e.code : null;
    return { verified: false, reason: (code && CERT_ERROR_WORDS[code]) ?? `the protocol check failed (${code ?? String(e)})` };
  }
  if (fields.expiry <= BigInt(Math.floor(nowSeconds))) {
    return { verified: false, reason: "it has already expired" };
  }
  if (fields.allowanceId.toString() !== success.allowanceId) {
    return { verified: false, reason: `the certificate is for allowance ${fields.allowanceId}, not ${success.allowanceId}` };
  }
  const earmarks = fields.earmarks.map(toHex);
  if (earmarks.length !== success.earmarks.length || earmarks.some((e, i) => e !== success.earmarks[i])) {
    return { verified: false, reason: "the certificate's earmarks differ from the ones the answer lists" };
  }
  return {
    verified: true,
    certificate: {
      allowanceId: fields.allowanceId.toString(),
      payerKeyHashHex: toHex(fields.payerKeyHash),
      capUnits: fields.cap.toString(),
      offlineLimitUnits: fields.offlineLimit.toString(),
      expiry: fields.expiry.toString(),
      earmarks,
      bondUnits: fields.bond.toString(),
    },
  };
}

/** The certificate as LOKA payment content (PAYMENT-V1 section 5): "L1|P|1|A|<base64url>". */
export function allowanceCode(allowBytes: Uint8Array): string {
  return encodeTransport("A", allowBytes);
}

/** Base units to "1.00" (2 decimals when whole cents, else 6). */
export function usd(units: string): string {
  return displayAmount(units);
}
