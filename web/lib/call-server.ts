// "Call me when it settles" (PLAN.md 3.9, web version), the server half. Server only: every
// variable read here has no NEXT_PUBLIC prefix, and unit/server-only.test.ts fails if a client
// module can reach this file.
//
// POST /api/call {to, lang, signature?}: checks the body, the configuration and the caps
// (lib/call-limits.ts) first, then finds a settled payment on devnet (lib/call-payment.ts),
// then asks the Vonage Voice API to call `to` and play a signed audio link. GET
// /api/call/audio?p&m: checks the link (lib/call-crypto.ts), has ElevenLabs read the payment
// (lib/call-speech.ts) and returns the MP3.
//
// The in-memory caps are per server instance and weak on a serverless host; the real bounds
// are the desk code (LOKA_CALL_CODE, given out at the LOKA Pay table), the Vonage account's
// balance and destination settings, and the LOKA_CALLS_OFF kill switch. Every in-memory map here and in lib/call-limits.ts has a maximum size and expiry.
//
// Privacy: the number is used for one Vonage request and one HMAC (the caps' key). It is never
// written to disk, never put in a response, and nothing here logs anything: no console call
// anywhere in this file, and every handler catches its own errors so the framework never logs
// one either (a JSON parse error can quote the body). unit/call.test.ts captures the console
// across a full call and checks the number never appears.
//
// Test seam (as lib/test-upstream.ts does for GitHub and devnet): LOKA_VONAGE_API_URL and
// LOKA_ELEVENLABS_API_URL may replace the real APIs only with a local endpoint, only in the e2e
// test mode, never in a deployed production build; the same holds for a local LOKA_PUBLIC_ORIGIN.

import { createHash, createHmac, createPrivateKey, randomBytes, timingSafeEqual, type KeyObject } from "node:crypto";
import { AUDIO_LINK_SECONDS, numberKey, signAudioParams, verifyAudioParams, vonageJwt } from "./call-crypto";
import { CallLimits, DeskCodeFailures, type LimitCheck } from "./call-limits";
import { latestSettlement, settlementBySignature, type SettledPayment } from "./call-payment";
import {
  SIGNATURE_MAX_AGE_MS,
  isCallLang,
  isCallableUsNumber,
  isPlausibleSignature,
  type CallAnswer,
  type CallErrorCode,
} from "./call-shared";
import { speechFor } from "./call-speech";
import { PINS } from "./pins";
import { serverReadOptions } from "./server-rpc";
import { describeFailure } from "./solana";
import { UpstreamConfigError, assertTestUpstream, isLoopback } from "./test-upstream";

export const VONAGE_API = "https://api.nexmo.com";
export const ELEVENLABS_API = "https://api.elevenlabs.io";
/** ElevenLabs' premade voice "Sarah". LOKA_ELEVENLABS_VOICE_ID replaces it. */
export const DEFAULT_VOICE_ID = "EXAVITQu4vr4xnSDxMaL";
export const ELEVENLABS_MODEL = "eleven_v4";
export const DEFAULT_PUBLIC_ORIGIN = "https://zerobars.us";
/** Vonage and ElevenLabs each get this long to answer before the request gives up. */
export const UPSTREAM_TIMEOUT_MS = 10_000;
const TTS_TIMEOUT_MS = 20_000;
const MAX_BODY_CHARS = 2048;

export interface CallConfig {
  applicationId: string;
  privateKey: KeyObject;
  /** Digits, E.164 without the plus. */
  fromNumber: string;
  elevenLabsKey: string;
  secret: string;
  voiceId: string;
  origin: string;
  vonageBase: string;
  elevenLabsBase: string;
  /** LOKA_CALL_CODE: the desk code every request must carry, or null when unset (local development). */
  deskCode: string | null;
}

/** Calls are off unless every required variable is set and readable; `reason` names variables, never values. */
export type CallConfigResult = { ok: true; config: CallConfig } | { ok: false; reason: string };

function testableBase(name: string, value: string | undefined, real: string): string {
  const override = value?.trim();
  if (!override) return real;
  if (!isLoopback(override)) throw new UpstreamConfigError(`${name} may only name a local test endpoint; the real API is always ${real}`);
  assertTestUpstream(name);
  return override.replace(/\/+$/, "");
}

/** The Vonage API base: the real one, or a local stand-in in the e2e test mode only. */
export function vonageApiBase(): string {
  return testableBase("LOKA_VONAGE_API_URL", process.env.LOKA_VONAGE_API_URL, VONAGE_API);
}

/** The ElevenLabs API base: the real one, or a local stand-in in the e2e test mode only. */
export function elevenLabsApiBase(): string {
  return testableBase("LOKA_ELEVENLABS_API_URL", process.env.LOKA_ELEVENLABS_API_URL, ELEVENLABS_API);
}

/** The origin Vonage fetches the voice from: https, or a local one in the e2e test mode only. */
export function publicOrigin(): string {
  const raw = process.env.LOKA_PUBLIC_ORIGIN?.trim();
  if (!raw) return DEFAULT_PUBLIC_ORIGIN;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpstreamConfigError("LOKA_PUBLIC_ORIGIN is not a URL");
  }
  if (isLoopback(raw)) {
    assertTestUpstream("LOKA_PUBLIC_ORIGIN");
    return url.origin;
  }
  if (url.protocol !== "https:") throw new UpstreamConfigError("LOKA_PUBLIC_ORIGIN must be an https origin, because Vonage fetches the voice from it");
  return url.origin;
}

let parsedKey: { b64: string; key: KeyObject } | null = null;

function vonageKey(b64: string): KeyObject | null {
  if (parsedKey?.b64 === b64) return parsedKey.key;
  try {
    const pem = Buffer.from(b64, "base64").toString("utf8");
    if (!pem.includes("-----BEGIN")) return null;
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "rsa") return null;
    parsedKey = { b64, key };
    return key;
  } catch {
    return null;
  }
}

export function callConfig(): CallConfigResult {
  const off = (reason: string): CallConfigResult => ({ ok: false, reason });
  if (process.env.LOKA_CALLS_OFF === "1") return off("LOKA_CALLS_OFF is set");
  const applicationId = process.env.LOKA_VONAGE_APPLICATION_ID?.trim() ?? "";
  const keyB64 = process.env.LOKA_VONAGE_PRIVATE_KEY_B64?.trim() ?? "";
  const fromNumber = process.env.LOKA_VONAGE_FROM_NUMBER?.trim() ?? "";
  const elevenLabsKey = process.env.ELEVENLABS_API_KEY?.trim() ?? "";
  const secret = process.env.LOKA_CALL_SECRET ?? "";
  const missing = Object.entries({
    LOKA_VONAGE_APPLICATION_ID: applicationId,
    LOKA_VONAGE_PRIVATE_KEY_B64: keyB64,
    LOKA_VONAGE_FROM_NUMBER: fromNumber,
    ELEVENLABS_API_KEY: elevenLabsKey,
    LOKA_CALL_SECRET: secret,
  })
    .filter(([, v]) => v === "")
    .map(([name]) => name);
  if (missing.length > 0) return off(`not set: ${missing.join(", ")}`);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(applicationId)) return off("LOKA_VONAGE_APPLICATION_ID is not a Vonage application id");
  if (!/^[1-9]\d{6,14}$/.test(fromNumber)) return off("LOKA_VONAGE_FROM_NUMBER must be the number's digits in E.164 form, without the plus");
  if (Buffer.byteLength(secret, "utf8") < 32) return off("LOKA_CALL_SECRET must be at least 32 bytes");
  const privateKey = vonageKey(keyB64);
  if (privateKey === null) return off("LOKA_VONAGE_PRIVATE_KEY_B64 is not the base64 of an RSA key in PEM form");
  const voiceId = process.env.LOKA_ELEVENLABS_VOICE_ID?.trim() || DEFAULT_VOICE_ID;
  if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) return off("LOKA_ELEVENLABS_VOICE_ID is not an ElevenLabs voice id");
  try {
    return {
      ok: true,
      config: {
        applicationId,
        privateKey,
        fromNumber,
        elevenLabsKey,
        secret,
        voiceId,
        origin: publicOrigin(),
        vonageBase: vonageApiBase(),
        elevenLabsBase: elevenLabsApiBase(),
        deskCode: process.env.LOKA_CALL_CODE?.trim() || null,
      },
    };
  } catch (e) {
    return off(e instanceof UpstreamConfigError ? e.message : "an endpoint setting could not be read");
  }
}

/** For the /call page: whether a press of the button can place a call on this deployment. */
export function callsEnabled(): boolean {
  return callConfig().ok;
}

/** Drops a map's oldest entries (insertion order) until it has room for one more. */
function makeRoom<V>(map: Map<string, V>, max: number): void {
  while (map.size >= max) map.delete(map.keys().next().value as string);
}

/**
 * Holds devnet answers for a few seconds, so many presses do not each read the chain. Bounded:
 * entries expire after `ttlMs`, and at `max` entries the oldest is dropped.
 */
export class ChainMemo {
  private readonly entries = new Map<string, { atMs: number; value: SettledPayment | null }>();
  constructor(
    private readonly ttlMs = 10_000,
    private readonly max = 64,
  ) {}
  get(key: string, nowMs: number): { value: SettledPayment | null } | null {
    const e = this.entries.get(key);
    if (!e || nowMs - e.atMs >= this.ttlMs) return null;
    return { value: e.value };
  }
  set(key: string, nowMs: number, value: SettledPayment | null): void {
    for (const [k, e] of this.entries) if (nowMs - e.atMs >= this.ttlMs) this.entries.delete(k);
    this.entries.delete(key);
    makeRoom(this.entries, this.max);
    this.entries.set(key, { atMs: nowMs, value });
  }
  get size(): number {
    return this.entries.size;
  }
}

/**
 * The MP3 for each audio link, kept until the link expires: Vonage may fetch it more than once.
 * Bounded: an entry leaves when its link expires, and at `max` entries the oldest is dropped.
 */
export class AudioCache {
  private readonly entries = new Map<string, { expiresAtMs: number; bytes: Promise<Uint8Array> }>();
  constructor(private readonly max = 64) {}
  get size(): number {
    return this.entries.size;
  }
  get(p: string, nowMs: number, expiresAtMs: number, make: () => Promise<Uint8Array>): Promise<Uint8Array> {
    for (const [key, e] of this.entries) if (e.expiresAtMs <= nowMs) this.entries.delete(key);
    const hit = this.entries.get(p);
    if (hit) return hit.bytes;
    makeRoom(this.entries, this.max);
    const bytes = make();
    const entry = { expiresAtMs, bytes };
    this.entries.set(p, entry);
    // A failed synthesis is not kept, so the next fetch tries again.
    bytes.catch(() => {
      if (this.entries.get(p) === entry) this.entries.delete(p);
    });
    return bytes;
  }
}

export interface CallDeps {
  now: () => number;
  limits: CallLimits;
  failures: DeskCodeFailures;
  /** Keys the desk-code failure limiter's client hashes; random per server process. */
  clientSecret: string;
  chain: ChainMemo;
  audio: AudioCache;
}

/** One set per server process: the caps and caches live in memory only (see lib/call-limits.ts). */
export const PROCESS_DEPS: CallDeps = {
  now: () => Date.now(),
  limits: new CallLimits(),
  failures: new DeskCodeFailures(),
  clientSecret: randomBytes(32).toString("hex"),
  chain: new ChainMemo(),
  audio: new AudioCache(),
};

/**
 * The desk-code failure limiter's key for this request: HMAC-SHA256(per-process secret, the
 * client's address), where the address is the first x-forwarded-for value (Vercel sets it to
 * the client's address), or one shared key when there is none. The address itself is never
 * kept, logged or returned.
 */
export function clientKey(request: Request, clientSecret: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0].trim();
  return createHmac("sha256", clientSecret).update(forwarded || "no-forwarded-for", "utf8").digest("hex");
}

const NO_STORE = { "cache-control": "no-store" };

function answer(status: number, body: CallAnswer, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

function refuse(status: number, error: CallErrorCode, reason?: string): Response {
  return answer(status, reason === undefined ? { error } : { error, reason });
}

function limited(check: Extract<LimitCheck, { ok: false }>): Response {
  return answer(
    429,
    { error: "rate_limited", limit: check.limit, retryAfterSeconds: check.retryAfterSeconds },
    { "retry-after": String(check.retryAfterSeconds) },
  );
}

/**
 * A phone company error title, safe to show: at most 120 characters, and any run of digits long
 * enough to be a phone number replaced, so a number can never come back in a response.
 */
export function safeTitle(title: string): string {
  return title.replace(/\+?\d[\d\s().-]{5,}\d/g, "[number]").slice(0, 120);
}

type CallOutcome = { ok: true } | { ok: false; reason: string };

async function placeVonageCall(config: CallConfig, to: string, audioUrl: string, nowSeconds: number): Promise<CallOutcome> {
  const body = {
    to: [{ type: "phone", number: to.slice(1) }],
    from: { type: "phone", number: config.fromNumber },
    ncco: [{ action: "stream", streamUrl: [audioUrl] }],
    event_url: [`${config.origin}/api/call/event`],
    event_method: "POST",
    ringing_timer: 45,
    length_timer: 120,
  };
  let response: Response;
  try {
    response = await fetch(`${config.vonageBase}/v1/calls`, {
      method: "POST",
      headers: { authorization: `Bearer ${vonageJwt(config.applicationId, config.privateKey, nowSeconds)}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: `no answer from the phone company within ${UPSTREAM_TIMEOUT_MS / 1000} s` };
  }
  if (response.ok) {
    await response.body?.cancel();
    return { ok: true };
  }
  let title = `HTTP ${response.status}`;
  try {
    const parsed = (await response.json()) as { title?: unknown };
    if (typeof parsed?.title === "string" && parsed.title.trim() !== "") title = parsed.title;
  } catch {
    // Not JSON: the status is the reason.
  }
  return { ok: false, reason: safeTitle(title) };
}

interface CallRequest {
  to: string;
  lang: "en" | "fr";
  signature: string | null;
  code: string | null;
}

const MAX_CODE_CHARS = 64;

/** The desk code compared in constant time: both sides hashed to the same length first. */
export function deskCodeMatches(expected: string, given: string): boolean {
  const a = createHash("sha256").update(expected, "utf8").digest();
  const b = createHash("sha256").update(given, "utf8").digest();
  return timingSafeEqual(a, b);
}

/** For the /call page: whether this deployment asks for the desk code. */
export function callCodeRequired(): boolean {
  const config = callConfig();
  return config.ok && config.config.deskCode !== null;
}

/** The request body, checked; a refusal Response otherwise. The body is never echoed. */
async function readCallRequest(request: Request): Promise<CallRequest | Response> {
  // A JSON content type means a cross-site page cannot send this without a CORS preflight,
  // which this route never answers.
  const type = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return refuse(415, "bad_request", "send JSON with content-type application/json");
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return refuse(413, "bad_request", "the body is too long");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return refuse(400, "bad_request", "the body is not JSON");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return refuse(400, "bad_request", "the body is not a JSON object");
  const { to, lang, signature, code } = body as { to?: unknown; lang?: unknown; signature?: unknown; code?: unknown };
  if (!isCallableUsNumber(to)) return refuse(400, "bad_number", "a US geographic number in the form +1 and 10 digits");
  if (!isCallLang(lang)) return refuse(400, "bad_lang", "lang is en or fr");
  if (signature !== undefined && signature !== null && !isPlausibleSignature(signature)) {
    return refuse(400, "bad_signature", "a Solana transaction signature in base58");
  }
  if (code !== undefined && code !== null && (typeof code !== "string" || code.length > MAX_CODE_CHARS)) {
    return refuse(400, "bad_request", "code is the desk code, as text");
  }
  return { to, lang, signature: typeof signature === "string" ? signature : null, code: typeof code === "string" ? code : null };
}

async function findPayment(signature: string | null, deps: CallDeps): Promise<SettledPayment | null> {
  const memoKey = signature ?? "latest";
  const memo = deps.chain.get(memoKey, deps.now());
  if (memo) return memo.value;
  const options = serverReadOptions();
  const payment =
    signature === null ? await latestSettlement(PINS.programId, options) : await settlementBySignature(signature, PINS.programId, options);
  // A signature not found yet may be found a moment later, so only a found one is kept.
  if (signature === null || payment !== null) deps.chain.set(memoKey, deps.now(), payment);
  return payment;
}

/**
 * The order is the point: every cheap check comes before any work that costs something.
 * 1. The body is read and checked, then the kill switch and the configuration.
 * 2. The desk code. A wrong or missing code counts only against this client's failure limit
 *    (lib/call-limits.ts DeskCodeFailures), never against a number or the site, so bad codes
 *    cannot lock anyone else out; a client over that limit gets 429 without its code checked.
 * 3. The site cap is checked, then the number's slot is taken; that slot stays taken whatever
 *    happens next, so failing requests from one number run into its cap.
 * 4. Only then is devnet read; then one call per number and payment; then the site counts the
 *    call and Vonage is asked.
 */
async function callFlow(request: Request, deps: CallDeps): Promise<Response> {
  const read = await readCallRequest(request);
  if (read instanceof Response) return read;
  const { to, lang, signature, code } = read;

  const config = callConfig();
  if (!config.ok) return refuse(503, "calls_off", config.reason);
  const { secret, origin } = config.config;

  const { deskCode } = config.config;
  if (deskCode !== null) {
    const client = clientKey(request, deps.clientSecret);
    const blocked = deps.failures.check(client);
    if (!blocked.ok) return limited(blocked);
    if (code === null || !deskCodeMatches(deskCode, code)) {
      deps.failures.record(client);
      return refuse(403, "wrong_code", "the desk code from the LOKA Pay table is needed");
    }
  }

  const site = deps.limits.checkSite();
  if (!site.ok) return limited(site);
  const key = numberKey(secret, to);
  const taken = deps.limits.takeNumber(key);
  if (!taken.ok) return limited(taken);

  let payment: SettledPayment | null;
  try {
    payment = await findPayment(signature, deps);
  } catch (e) {
    return refuse(502, "chain_read_failed", describeFailure(e));
  }
  if (payment === null) return refuse(404, "no_settled_payment");
  const nowMs = deps.now();
  if (signature !== null && nowMs - payment.blockTime * 1000 > SIGNATURE_MAX_AGE_MS) {
    return refuse(409, "too_old", `settled more than ${SIGNATURE_MAX_AGE_MS / 60_000} minutes ago`);
  }
  const once = deps.limits.claimPayment(key, payment.signature);
  if (!once.ok) return limited(once);
  // The site cap counts the calls we actually try to place.
  const placing = deps.limits.takeSite();
  if (!placing.ok) return limited(placing);

  const nowSeconds = Math.floor(nowMs / 1000);
  const { p, m } = signAudioParams(secret, {
    sig: payment.signature,
    lang,
    amountUnits: payment.amountUnits,
    blockTime: payment.blockTime,
    exp: nowSeconds + AUDIO_LINK_SECONDS,
  });
  const audioUrl = `${origin}/api/call/audio?p=${p}&m=${m}`;
  const placed = await placeVonageCall(config.config, to, audioUrl, nowSeconds);
  if (!placed.ok) return refuse(502, "call_failed", placed.reason);
  return answer(200, {
    status: "calling",
    payment: { signature: payment.signature, amountUnits: payment.amountUnits, settledAtMs: payment.blockTime * 1000, explorer: payment.explorer },
  });
}

/** POST /api/call. Never throws: an unexpected error is answered, not logged. */
export async function handleCall(request: Request, deps: CallDeps = PROCESS_DEPS): Promise<Response> {
  try {
    return await callFlow(request, deps);
  } catch {
    return refuse(500, "call_failed", "unexpected error on our server");
  }
}

async function synthesize(config: CallConfig, text: string): Promise<Uint8Array> {
  const url = `${config.elevenLabsBase}/v1/text-to-speech/${encodeURIComponent(config.voiceId)}?output_format=mp3_44100_128`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": config.elevenLabsKey, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: ELEVENLABS_MODEL }),
    cache: "no-store",
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`ElevenLabs answered HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error("ElevenLabs answered no audio");
  return bytes;
}

async function audioFlow(request: Request, deps: CallDeps): Promise<Response> {
  const config = callConfig();
  if (!config.ok) return new Response(null, { status: 503, headers: NO_STORE });
  const url = new URL(request.url);
  const nowMs = deps.now();
  const check = verifyAudioParams(config.config.secret, url.searchParams.get("p"), url.searchParams.get("m"), Math.floor(nowMs / 1000));
  if (!check.ok) return Response.json({ error: check.reason }, { status: 403, headers: NO_STORE });
  const { params } = check;
  const p = url.searchParams.get("p") as string;
  let bytes: Uint8Array;
  try {
    bytes = await deps.audio.get(p, nowMs, params.exp * 1000, () =>
      synthesize(config.config, speechFor({ amountUnits: params.amountUnits, blockTime: params.blockTime }, params.lang, nowMs)),
    );
  } catch {
    return Response.json({ error: "voice_failed" }, { status: 502, headers: NO_STORE });
  }
  return new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": "audio/mpeg", ...NO_STORE } });
}

/** GET /api/call/audio. Never throws. */
export async function handleAudio(request: Request, deps: CallDeps = PROCESS_DEPS): Promise<Response> {
  try {
    return await audioFlow(request, deps);
  } catch {
    return new Response(null, { status: 500, headers: NO_STORE });
  }
}

/** POST /api/call/event: Vonage's call events. Answered, never read, stored or logged. */
export function handleEvent(): Response {
  return new Response(null, { status: 204, headers: NO_STORE });
}
