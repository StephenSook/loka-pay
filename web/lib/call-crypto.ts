// The keyed pieces of the phone call (PLAN.md 3.9), with node:crypto only. Server only.
// - numberKey: the rate limits remember HMAC-SHA256(LOKA_CALL_SECRET, number), never the number.
// - The audio link Vonage fetches carries the payment details in `p` (base64url JSON) and
//   m = HMAC-SHA256(LOKA_CALL_SECRET, p) in hex, checked in constant time, so nobody can make
//   the voice say anything else or spend ElevenLabs credits with a link of their own.
//   A number always starts with "+" and `p` with "eyJ" (base64url of '{"'), so the two
//   HMAC inputs can never be the same string.
// - vonageJwt: the RS256 token the Vonage Voice API takes, signed with the application's key.

import { createHmac, randomUUID, sign, timingSafeEqual, type KeyObject } from "node:crypto";
import { isCallLang, isPlausibleSignature, type CallLang } from "./call-shared";
import { isUnixSeconds } from "./time";

export function base64url(bytes: Uint8Array | string): string {
  return (typeof bytes === "string" ? Buffer.from(bytes, "utf8") : Buffer.from(bytes)).toString("base64url");
}

function hmacHex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** The rate limits' key for a number: HMAC-SHA256(secret, number) in hex. */
export function numberKey(secret: string, number: string): string {
  return hmacHex(secret, number);
}

/** What the audio link carries: everything the voice says, and when the link stops working. */
export interface AudioParams {
  sig: string;
  lang: CallLang;
  amountUnits: string;
  /** Block time of the settlement, Unix seconds. */
  blockTime: number;
  /** When the link expires, Unix seconds. */
  exp: number;
}

/** An audio link works for this long after the call is placed. */
export const AUDIO_LINK_SECONDS = 600;

export function signAudioParams(secret: string, params: AudioParams): { p: string; m: string } {
  const p = base64url(JSON.stringify(params));
  return { p, m: hmacHex(secret, p) };
}

export type AudioCheck = { ok: true; params: AudioParams } | { ok: false; reason: "tampered" | "expired" | "malformed" };

/** Checks an audio link's `p` and `m`: the HMAC first (constant time), then the fields, then the expiry. */
export function verifyAudioParams(secret: string, p: string | null, m: string | null, nowSeconds: number): AudioCheck {
  if (!p || !m || p.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(p) || !/^[0-9a-f]{64}$/.test(m)) return { ok: false, reason: "malformed" };
  const expected = Buffer.from(hmacHex(secret, p), "hex");
  const given = Buffer.from(m, "hex");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { ok: false, reason: "tampered" };
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const v = value as Partial<AudioParams> | null;
  if (
    typeof v !== "object" ||
    v === null ||
    !isPlausibleSignature(v.sig) ||
    !isCallLang(v.lang) ||
    typeof v.amountUnits !== "string" ||
    !/^\d{1,20}$/.test(v.amountUnits) ||
    !isUnixSeconds(v.blockTime) ||
    !isUnixSeconds(v.exp)
  ) {
    return { ok: false, reason: "malformed" };
  }
  if (v.exp <= nowSeconds) return { ok: false, reason: "expired" };
  return { ok: true, params: { sig: v.sig, lang: v.lang, amountUnits: v.amountUnits, blockTime: v.blockTime, exp: v.exp } };
}

/** A Vonage application JWT lives this long. */
export const VONAGE_JWT_SECONDS = 300;

/**
 * The JWT for one Vonage Voice API request: header {alg: RS256, typ: JWT}, claims
 * {application_id, iat, exp: iat + 300, jti}, signed RSASSA-PKCS1-v1_5 with SHA-256.
 */
export function vonageJwt(applicationId: string, privateKey: KeyObject, nowSeconds: number, jti: string = randomUUID()): string {
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({ application_id: applicationId, iat: nowSeconds, exp: nowSeconds + VONAGE_JWT_SECONDS, jti }),
  );
  const signingInput = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(signingInput, "utf8"), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}
