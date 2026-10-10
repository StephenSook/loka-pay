import { createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { numberKey, signAudioParams, verifyAudioParams, vonageJwt, type AudioParams } from "../lib/call-crypto";
import { CallLimits, NUMBER_WINDOW_MS, PAYMENT_MEMORY_MS, SITE_LIMIT, SITE_WINDOW_MS } from "../lib/call-limits";
import { latestSettlement, settlementBySignature, settlementOf } from "../lib/call-payment";
import { AudioCache, ChainMemo, callConfig, handleAudio, handleCall, safeTitle, type CallDeps } from "../lib/call-server";
import { isCallLang, isNanpNumber, isNewSettlement, isPlausibleSignature, normalizeUsNumber } from "../lib/call-shared";
import { agoWords, speechFor } from "../lib/call-speech";
import type { Row } from "../lib/program-feed";

// "Call me when it settles" (PLAN.md 3.9). The transactions are real devnet transactions recorded
// in unit/fixtures/devnet-transactions.json; the local servers below are TEST FIXTURES on
// 127.0.0.1 standing in for devnet's JSON-RPC, Vonage and ElevenLabs, so no test reaches a real
// phone company or voice service. The RSA key and the secret are made fresh here, never committed.
// Phone numbers are written as "+" + digits so the repository's phone scrub never matches them;
// all are in the fictional 555 range.

const repoRoot = path.resolve(__dirname, "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));
const recorded = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "devnet-transactions.json"), "utf8"));
const P: string = pins.programId;
const REDEEM = recorded.redeem;
const REDEEM_SIG: string = REDEEM.transaction.signatures[0];
const REFUSED = recorded.refusedRedeem;
const REFUSED_SIG: string = REFUSED.transaction.signatures[0];

const PLUS = "+";
const NUMBER = `${PLUS}14045550123`;
const NATIONAL = "4045550123";
const OTHER_NUMBER = `${PLUS}14045550199`;

const { privateKey: PRIVATE_PEM, publicKey: PUBLIC_PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const SECRET = randomBytes(32).toString("hex");
const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

// ---------- input checks ----------

test.describe("number, language and signature checks", () => {
  test("only +1 NANP numbers in E.164 form pass", () => {
    for (const ok of [NUMBER, `${PLUS}12125550100`, `${PLUS}19995550100`]) expect(isNanpNumber(ok), ok).toBe(true);
    for (const bad of [
      NATIONAL,
      `1${NATIONAL}`,
      `${PLUS}1${NATIONAL}0`,
      `${PLUS}10045550123`, // area code starting with 0
      `${PLUS}11045550123`, // area code starting with 1
      `${PLUS}14041550123`, // exchange starting with 1
      `${PLUS}14040550123`, // exchange starting with 0
      `${PLUS}44${NATIONAL}`,
      `${PLUS}1 404 555 0123`,
      "",
      12345,
      null,
    ]) {
      expect(isNanpNumber(bad), String(bad)).toBe(false);
    }
  });

  test("what a visitor types is normalized, and nothing else is guessed", () => {
    expect(normalizeUsNumber("(404) 555-0123")).toBe(NUMBER);
    expect(normalizeUsNumber("404.555.0123")).toBe(NUMBER);
    expect(normalizeUsNumber(`1 404 555 0123`)).toBe(NUMBER);
    expect(normalizeUsNumber(` ${PLUS}1 (404) 555-0123 `)).toBe(NUMBER);
    for (const bad of ["555-0123", `${PLUS}44 20 7946 0958`, "404 555 01234", "abc", "", `${PLUS}1 104 555 0123`]) {
      expect(normalizeUsNumber(bad), bad).toBeNull();
    }
  });

  test("lang is en or fr; a signature is base58 of 64 bytes", () => {
    expect(isCallLang("en")).toBe(true);
    expect(isCallLang("fr")).toBe(true);
    for (const bad of ["EN", "es", "", undefined, 1]) expect(isCallLang(bad), String(bad)).toBe(false);
    expect(isPlausibleSignature(REDEEM_SIG)).toBe(true);
    expect(isPlausibleSignature(P)).toBe(false); // 32 bytes: an address, not a signature
    expect(isPlausibleSignature(`${REDEEM_SIG.slice(0, -1)}0`)).toBe(false); // 0 is not base58
    expect(isPlausibleSignature("x".repeat(200))).toBe(false);
    expect(isPlausibleSignature(42)).toBe(false);
  });
});

// ---------- the audio link ----------

const PARAMS: AudioParams = { sig: REDEEM_SIG, lang: "en", amountUnits: "100000", blockTime: REDEEM.blockTime, exp: 2_000_000_000 };

test.describe("audio link HMAC", () => {
  test("a signed link verifies and gives its fields back", () => {
    const { p, m } = signAudioParams(SECRET, PARAMS);
    expect(p).toMatch(/^eyJ[A-Za-z0-9_-]+$/);
    expect(m).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyAudioParams(SECRET, p, m, PARAMS.exp - 1)).toEqual({ ok: true, params: PARAMS });
  });

  test("a changed p, a changed m or another secret is refused as tampered", () => {
    const { p, m } = signAudioParams(SECRET, PARAMS);
    // A link for 500 dollars instead of 10 cents, keeping the old m.
    const forged = signAudioParams("another secret, at least thirty-two bytes long", { ...PARAMS, amountUnits: "500000000" }).p;
    expect(verifyAudioParams(SECRET, forged, m, PARAMS.exp - 1)).toEqual({ ok: false, reason: "tampered" });
    const flipped = m.slice(0, -1) + (m.endsWith("0") ? "1" : "0");
    expect(verifyAudioParams(SECRET, p, flipped, PARAMS.exp - 1)).toEqual({ ok: false, reason: "tampered" });
    expect(verifyAudioParams("x".repeat(40), p, m, PARAMS.exp - 1)).toEqual({ ok: false, reason: "tampered" });
  });

  test("an expired link is refused; malformed input never throws", () => {
    const { p, m } = signAudioParams(SECRET, PARAMS);
    expect(verifyAudioParams(SECRET, p, m, PARAMS.exp)).toEqual({ ok: false, reason: "expired" });
    expect(verifyAudioParams(SECRET, null, m, 0)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyAudioParams(SECRET, p, "ABC", 0)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyAudioParams(SECRET, `${p}!`, m, 0)).toEqual({ ok: false, reason: "malformed" });
    // Correctly signed, but not the right fields.
    const odd = signAudioParams(SECRET, { ...PARAMS, lang: "de" } as unknown as AudioParams);
    expect(verifyAudioParams(SECRET, odd.p, odd.m, 0)).toEqual({ ok: false, reason: "malformed" });
  });

  test("the number's key is an HMAC, not the number", () => {
    const key = numberKey(SECRET, NUMBER);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain(NATIONAL);
    expect(numberKey(SECRET, NUMBER)).toBe(key);
    expect(numberKey(SECRET, OTHER_NUMBER)).not.toBe(key);
    expect(numberKey("y".repeat(40), NUMBER)).not.toBe(key);
  });
});

// ---------- the words ----------

test.describe("speechFor", () => {
  const settled = REDEEM.blockTime as number;
  const at = (minutes: number) => (settled + minutes * 60) * 1000;

  test("English: the exact text, sandbox and test money, no em or en dash", () => {
    const text = speechFor({ amountUnits: "2500000", blockTime: settled }, "en", at(3));
    expect(text).toBe(
      "Hello. This is an automated demo call from LOKA Pay at the Hacklanta hackathon, asked for on zerobars dot U S. " +
        "A sandbox payment of 2 dollars and 50 cents was settled on Solana devnet 3 minutes ago. " +
        "Before paying the shop, the chain checked the signature made by the payer's phone. " +
        "This is test money with no real value. Goodbye.",
    );
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toContain(EN_DASH);
  });

  test("French: the same facts, bac à sable and argent de test, no em or en dash", () => {
    const text = speechFor({ amountUnits: "2500000", blockTime: settled }, "fr", at(3));
    expect(text).toBe(
      "Bonjour. Ceci est un appel de démonstration automatique de LOKA Pay, au hackathon Hacklanta, demandé sur zerobars point U S. " +
        "Un paiement en bac à sable de 2 dollars et 50 cents a été réglé sur Solana devnet il y a 3 minutes. " +
        "Avant de payer la boutique, la blockchain a vérifié la signature créée par le téléphone du payeur. " +
        "C'est de l'argent de test, sans valeur réelle. Au revoir.",
    );
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toContain(EN_DASH);
  });

  test("amounts: dollars and cents from 6-decimal base units", () => {
    const say = (units: string, lang: "en" | "fr" = "en") => speechFor({ amountUnits: units, blockTime: settled }, lang, at(5));
    expect(say("100000")).toContain("payment of 10 cents was settled");
    expect(say("1000000")).toContain("payment of 1 dollar was settled");
    expect(say("1010000")).toContain("payment of 1 dollar and 1 cent was settled");
    expect(say("12000000")).toContain("payment of 12 dollars was settled");
    expect(say("1234567")).toContain("payment of about 1 dollar and 23 cents was settled");
    expect(say("4")).toContain("payment of less than 1 cent was settled");
    expect(say("1010000", "fr")).toContain("de 1 dollar et 1 cent a été réglé");
    expect(say("4", "fr")).toContain("de moins d'un cent a été réglé");
  });

  test("how long ago, in minutes, then hours, then days", () => {
    const ms = settled * 1000;
    const en = (minutes: number) => agoWords(ms, ms + minutes * 60_000, "en");
    const fr = (minutes: number) => agoWords(ms, ms + minutes * 60_000, "fr");
    expect(en(0)).toBe("less than a minute ago");
    expect(en(0.99)).toBe("less than a minute ago");
    expect(en(1)).toBe("1 minute ago");
    expect(en(14)).toBe("14 minutes ago");
    expect(en(119)).toBe("119 minutes ago");
    expect(en(120)).toBe("2 hours ago");
    expect(en(60 * 47)).toBe("47 hours ago");
    expect(en(60 * 48)).toBe("2 days ago");
    // A block time slightly ahead of this server's clock is "less than a minute".
    expect(agoWords(ms, ms - 30_000, "en")).toBe("less than a minute ago");
    expect(fr(0)).toBe("il y a moins d'une minute");
    expect(fr(1)).toBe("il y a 1 minute");
    expect(fr(14)).toBe("il y a 14 minutes");
    expect(fr(60 * 3)).toBe("il y a 3 heures");
    expect(fr(60 * 24 * 3)).toBe("il y a 3 jours");
  });
});

// ---------- the Vonage JWT ----------

test("vonageJwt: RS256 header, the application id, iat, exp = iat + 300 and jti; the signature verifies with the public key", () => {
  const privateKey = callKeyObject();
  const token = vonageJwt("unit-test-application", privateKey, 1_791_612_000, "unit-test-jti");
  const [h, c, s] = token.split(".");
  expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
  expect(JSON.parse(Buffer.from(c, "base64url").toString())).toEqual({
    application_id: "unit-test-application",
    iat: 1_791_612_000,
    exp: 1_791_612_300,
    jti: "unit-test-jti",
  });
  const publicKey = createPublicKey(PUBLIC_PEM);
  expect(verify("sha256", Buffer.from(`${h}.${c}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  // Changing the claims breaks the signature.
  const other = Buffer.from(JSON.stringify({ application_id: "someone-else", iat: 1, exp: 301, jti: "x" })).toString("base64url");
  expect(verify("sha256", Buffer.from(`${h}.${other}`), publicKey, Buffer.from(s, "base64url"))).toBe(false);
  // A fresh jti each time by default.
  expect(vonageJwt("unit-test-application", privateKey, 1).split(".")[1]).not.toBe(vonageJwt("unit-test-application", privateKey, 1).split(".")[1]);
});

function callKeyObject() {
  // The parsed key, read the way the server reads LOKA_VONAGE_PRIVATE_KEY_B64.
  const result = withEnvSync(callEnv("http://127.0.0.1:9"), () => callConfig());
  if (!result.ok) throw new Error(`test config refused: ${result.reason}`);
  return result.config.privateKey;
}

// ---------- the caps ----------

test.describe("call caps, with an injected clock", () => {
  test("two calls per number per 30 minutes, then rate limited until the oldest leaves the window", () => {
    let now = 1_000_000;
    const limits = new CallLimits(() => now);
    const key = numberKey(SECRET, NUMBER);
    expect(limits.reserve(key, "sig-a").ok).toBe(true);
    now += 60_000;
    expect(limits.reserve(key, "sig-b").ok).toBe(true);
    now += 60_000;
    expect(limits.check(key)).toEqual({ ok: false, limit: "number", retryAfterSeconds: (NUMBER_WINDOW_MS - 120_000) / 1000 });
    expect(limits.reserve(key, "sig-c")).toEqual({ ok: false, limit: "number", retryAfterSeconds: (NUMBER_WINDOW_MS - 120_000) / 1000 });
    // Another number is not affected.
    expect(limits.check(numberKey(SECRET, OTHER_NUMBER))).toEqual({ ok: true });
    now = 1_000_000 + NUMBER_WINDOW_MS;
    expect(limits.reserve(key, "sig-c").ok).toBe(true);
  });

  test("one call per number and payment, remembered for 24 hours", () => {
    let now = 5_000_000;
    const limits = new CallLimits(() => now);
    const key = numberKey(SECRET, NUMBER);
    expect(limits.reserve(key, REDEEM_SIG).ok).toBe(true);
    now += NUMBER_WINDOW_MS;
    expect(limits.reserve(key, REDEEM_SIG)).toEqual({ ok: false, limit: "payment", retryAfterSeconds: (PAYMENT_MEMORY_MS - NUMBER_WINDOW_MS) / 1000 });
    // The same payment for another number, and another payment for this number, are fine.
    expect(limits.reserve(numberKey(SECRET, OTHER_NUMBER), REDEEM_SIG).ok).toBe(true);
    expect(limits.reserve(key, REFUSED_SIG).ok).toBe(true);
    now = 5_000_000 + PAYMENT_MEMORY_MS;
    expect(limits.reserve(key, REDEEM_SIG).ok).toBe(true);
  });

  test("at most 30 calls an hour for the site", () => {
    let now = 9_000_000;
    const limits = new CallLimits(() => now);
    for (let i = 0; i < SITE_LIMIT; i += 1) {
      expect(limits.reserve(numberKey(SECRET, `${PLUS}1404555${String(i).padStart(4, "0")}`), "sig").ok).toBe(true);
      now += 1000;
    }
    const fresh = numberKey(SECRET, OTHER_NUMBER);
    expect(limits.check(fresh)).toEqual({ ok: false, limit: "site", retryAfterSeconds: (SITE_WINDOW_MS - SITE_LIMIT * 1000) / 1000 });
    now = 9_000_000 + SITE_WINDOW_MS;
    expect(limits.check(fresh)).toEqual({ ok: true });
  });

  test("release gives a refused call's places back", () => {
    const now = 1_000;
    const limits = new CallLimits(() => now);
    const key = numberKey(SECRET, NUMBER);
    const first = limits.reserve(key, "sig-a");
    expect(first.ok).toBe(true);
    if (first.ok) limits.release(first.reservation);
    expect(limits.reserve(key, "sig-a").ok).toBe(true);
    expect(limits.reserve(key, "sig-b").ok).toBe(true);
    expect(limits.reserve(key, "sig-c").ok).toBe(false);
  });
});

// ---------- which payment ----------

test.describe("payment resolution (real devnet transactions)", () => {
  test("the settled redeem resolves to its signature, amount and block time", () => {
    expect(settlementOf(REDEEM, P)).toEqual({
      signature: REDEEM_SIG,
      amountUnits: "100000",
      blockTime: REDEEM.blockTime,
      explorer: `https://explorer.solana.com/tx/${REDEEM_SIG}?cluster=devnet`,
    });
  });

  test("the refused 6011 redeem, the other program transactions, and the redeem read for another program do not", () => {
    expect(REFUSED.meta.err).toEqual({ InstructionError: [2, { Custom: 6011 }] });
    expect(settlementOf(REFUSED, P)).toBeNull();
    for (const name of ["registerMerchant", "initializeVault", "deploy"]) expect(settlementOf(recorded[name], P), name).toBeNull();
    expect(settlementOf(REDEEM, pins.mint)).toBeNull();
  });

  test("a failed transaction's rolled-back NoteRedeemed event is never read out as paid", () => {
    // TEST FIXTURE: the recorded settled redeem, with its err field changed to the 6011 error.
    const failed = { ...REDEEM, meta: { ...REDEEM.meta, err: { InstructionError: [2, { Custom: 6011 }] } } };
    expect(settlementOf(failed, P)).toBeNull();
    // Metadata that does not say how it ended: not a success either.
    expect(settlementOf({ ...REDEEM, meta: null }, P)).toBeNull();
    const { err: _err, ...noErr } = REDEEM.meta;
    void _err;
    expect(settlementOf({ ...REDEEM, meta: noErr }, P)).toBeNull();
    // No block time: nothing to say about how long ago.
    expect(settlementOf({ ...REDEEM, blockTime: null }, P)).toBeNull();
    expect(settlementOf("not a transaction", P)).toBeNull();
  });

  test("latestSettlement skips the failed newest signature and returns the redeem; by signature too", async () => {
    await withStandIn({}, async (s) => {
      const options = { url: `${s.base}/rpc`, retries: 0 };
      expect((await latestSettlement(P, options))?.signature).toBe(REDEEM_SIG);
      // The failed one was never read in full: only succeeded signatures are.
      expect(s.seen.getTransaction).not.toContain(REFUSED_SIG);
      expect(s.seen.getTransaction[0]).toBe(REDEEM_SIG);
      expect((await settlementBySignature(REDEEM_SIG, P, options))?.amountUnits).toBe("100000");
      expect(await settlementBySignature(REFUSED_SIG, P, options)).toBeNull();
    });
  });

  test("no settled payment in the history gives null; a read that failed throws instead", async () => {
    await withStandIn({ history: [REFUSED, recorded.registerMerchant, recorded.initializeVault] }, async (s) => {
      expect(await latestSettlement(P, { url: `${s.base}/rpc`, retries: 0 })).toBeNull();
    });
    await withStandIn({ failTransaction: REDEEM_SIG }, async (s) => {
      await expect(latestSettlement(P, { url: `${s.base}/rpc`, retries: 0 })).rejects.toThrow("node is behind");
    });
  });
});

// ---------- the armed page's choice ----------

test("isNewSettlement: a read, succeeded redeem that arrived live or after the first history read", () => {
  const row = (over: Partial<Row>): Row => ({
    signature: REDEEM_SIG,
    slot: 1,
    blockTime: 1,
    result: "succeeded",
    actions: ["redeem_note"],
    amounts: [{ label: "Note redeemed", units: "100000" }],
    error: null,
    errText: null,
    truncated: false,
    arrivedLive: true,
    seenAtMs: 1,
    details: "read",
    ...over,
  });
  expect(isNewSettlement(row({}), null)).toBe(true);
  expect(isNewSettlement(row({ details: "reading" }), null)).toBe(false);
  expect(isNewSettlement(row({ result: "failed" }), null)).toBe(false);
  expect(isNewSettlement(row({ result: "unknown" }), null)).toBe(false);
  expect(isNewSettlement(row({ actions: ["open_allowance"] }), null)).toBe(false);
  expect(isNewSettlement(row({ amounts: [] }), null)).toBe(false);
  // From a history read: only when the first history read did not have it.
  expect(isNewSettlement(row({ arrivedLive: false }), null)).toBe(false);
  expect(isNewSettlement(row({ arrivedLive: false }), new Set([REDEEM_SIG]))).toBe(false);
  expect(isNewSettlement(row({ arrivedLive: false }), new Set(["older"]))).toBe(true);
});

// ---------- the routes, against local stand-ins ----------

test.describe("POST /api/call and GET /api/call/audio", () => {
  test("calls off unless every required variable is set, or when LOKA_CALLS_OFF=1", async () => {
    await withStandIn({}, async (s) => {
      for (const name of ["LOKA_VONAGE_APPLICATION_ID", "LOKA_VONAGE_PRIVATE_KEY_B64", "LOKA_VONAGE_FROM_NUMBER", "ELEVENLABS_API_KEY", "LOKA_CALL_SECRET"]) {
        const r = await withEnv(callEnv(s.base, { [name]: undefined }), () => handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()));
        expect(r.status, name).toBe(503);
        expect(await r.json(), name).toEqual({ error: "calls_off", reason: `not set: ${name}` });
      }
      const off = await withEnv(callEnv(s.base, { LOKA_CALLS_OFF: "1" }), () => handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()));
      expect(await off.json()).toEqual({ error: "calls_off", reason: "LOKA_CALLS_OFF is set" });
      const short = await withEnv(callEnv(s.base, { LOKA_CALL_SECRET: "too short" }), () => handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()));
      expect((await short.json()).reason).toBe("LOKA_CALL_SECRET must be at least 32 bytes");
      const badKey = await withEnv(callEnv(s.base, { LOKA_VONAGE_PRIVATE_KEY_B64: Buffer.from("not a key").toString("base64") }), () =>
        handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()),
      );
      expect((await badKey.json()).reason).toContain("LOKA_VONAGE_PRIVATE_KEY_B64");
      // A real host in place of the Vonage API is refused even in test mode.
      const remote = await withEnv(callEnv(s.base, { LOKA_VONAGE_API_URL: "https://vonage.example.org" }), () => callConfig());
      expect(remote.ok).toBe(false);
      // A local stand-in is refused in a deployed production build.
      const deployed = await withEnv(callEnv(s.base, { NODE_ENV: "production", VERCEL: "1" }), () => callConfig());
      expect(deployed.ok).toBe(false);
      expect(s.seen.vonage).toHaveLength(0);
    });
  });

  test("bad input is refused before anything is read or called, and never echoed", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const cases: Array<[Request, number, string]> = [
          [new Request("http://x/api/call", { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ to: NUMBER, lang: "en" }) }), 415, "bad_request"],
          [new Request("http://x/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: `{"to":"${NUMBER}"` }), 400, "bad_request"],
          [callRequest([NUMBER]), 400, "bad_request"],
          [callRequest({ to: NATIONAL, lang: "en" }), 400, "bad_number"],
          [callRequest({ to: `${PLUS}44${NATIONAL}`, lang: "en" }), 400, "bad_number"],
          [callRequest({ to: NUMBER, lang: "es" }), 400, "bad_lang"],
          [callRequest({ to: NUMBER, lang: "en", signature: "not-a-signature" }), 400, "bad_signature"],
          [callRequest({ to: NUMBER, lang: "en", pad: "x".repeat(3000) }), 413, "bad_request"],
        ];
        for (const [request, status, error] of cases) {
          const r = await handleCall(request, deps());
          const text = await r.text();
          expect(r.status, error).toBe(status);
          expect(JSON.parse(text).error, error).toBe(error);
          expect(text).not.toContain(NATIONAL);
          expect(r.headers.get("cache-control")).toBe("no-store");
        }
      });
      expect(s.seen.rpc).toHaveLength(0);
      expect(s.seen.vonage).toHaveLength(0);
    });
  });

  test("the latest settled payment: one Vonage call with the RS256 JWT, the number without +, and a signed audio link", async () => {
    await withStandIn({}, async (s) => {
      const now = (REDEEM.blockTime + 7 * 60) * 1000;
      const d = deps(now);
      const r = await withEnv(callEnv(s.base), () => handleCall(callRequest({ to: NUMBER, lang: "fr" }), d));
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body).toEqual({
        status: "calling",
        payment: { signature: REDEEM_SIG, amountUnits: "100000", settledAtMs: REDEEM.blockTime * 1000, explorer: `https://explorer.solana.com/tx/${REDEEM_SIG}?cluster=devnet` },
      });
      expect(JSON.stringify(body)).not.toContain(NATIONAL);

      expect(s.seen.vonage).toHaveLength(1);
      const call = s.seen.vonage[0];
      const [h, c, sig] = call.authorization.replace(/^Bearer /, "").split(".");
      expect(verify("sha256", Buffer.from(`${h}.${c}`), createPublicKey(PUBLIC_PEM), Buffer.from(sig, "base64url"))).toBe(true);
      const claims = JSON.parse(Buffer.from(c, "base64url").toString());
      expect(claims.application_id).toBe("unit-test-application");
      expect(claims.exp - claims.iat).toBe(300);
      const sent = call.body as {
        to: Array<{ type: string; number: string }>;
        from: { type: string; number: string };
        ncco: Array<{ action: string; streamUrl: string[] }>;
        event_url: string[];
        event_method: string;
        ringing_timer: number;
        length_timer: number;
      };
      expect(sent.to).toEqual([{ type: "phone", number: `1${NATIONAL}` }]);
      expect(sent.from).toEqual({ type: "phone", number: "12025550100" });
      expect(sent.event_url).toEqual(["http://127.0.0.1:3999/api/call/event"]);
      expect(sent.event_method).toBe("POST");
      expect(sent.ringing_timer).toBe(45);
      expect(sent.length_timer).toBe(120);
      expect(sent.ncco).toHaveLength(1);
      expect(sent.ncco[0].action).toBe("stream");
      const audioUrl = new URL(sent.ncco[0].streamUrl[0]);
      expect(audioUrl.origin + audioUrl.pathname).toBe("http://127.0.0.1:3999/api/call/audio");
      expect(audioUrl.href).not.toContain(NATIONAL);
      const check = verifyAudioParams(SECRET, audioUrl.searchParams.get("p"), audioUrl.searchParams.get("m"), now / 1000);
      expect(check).toEqual({ ok: true, params: { sig: REDEEM_SIG, lang: "fr", amountUnits: "100000", blockTime: REDEEM.blockTime, exp: now / 1000 + 600 } });

      // The audio: ElevenLabs reads the French text; a second fetch is served from memory.
      const audio = await withEnv(callEnv(s.base), () => handleAudio(new Request(audioUrl.href.replace("http://127.0.0.1:3999", "http://x")), d));
      expect(audio.status).toBe(200);
      expect(audio.headers.get("content-type")).toBe("audio/mpeg");
      expect(audio.headers.get("cache-control")).toBe("no-store");
      expect(Buffer.from(await audio.arrayBuffer()).toString()).toBe(STAND_IN_AUDIO);
      expect(s.seen.speech).toHaveLength(1);
      const tts = s.seen.speech[0];
      expect(tts.apiKey).toBe("unit-test-elevenlabs-key");
      expect(tts.voice).toBe("EXAVITQu4vr4xnSDxMaL");
      expect(tts.outputFormat).toBe("mp3_44100_128");
      expect((tts.body as { model_id: string }).model_id).toBe("eleven_v4");
      expect((tts.body as { text: string }).text).toContain("Un paiement en bac à sable de 10 cents a été réglé sur Solana devnet il y a 7 minutes.");
      expect(JSON.stringify(tts.body)).not.toContain(NATIONAL);
      const again = await withEnv(callEnv(s.base), () => handleAudio(new Request(audioUrl.href), d));
      expect(again.status).toBe(200);
      expect(s.seen.speech).toHaveLength(1);

      // A tampered link: refused, and ElevenLabs is not asked.
      const tampered = new URL(audioUrl.href);
      tampered.searchParams.set("m", "0".repeat(64));
      const refused = await withEnv(callEnv(s.base), () => handleAudio(new Request(tampered.href), d));
      expect(refused.status).toBe(403);
      expect(s.seen.speech).toHaveLength(1);
    });
  });

  test("a named signature: settled within 15 minutes calls; older is 409 too_old; refused is 404", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const fresh = await handleCall(callRequest({ to: NUMBER, lang: "en", signature: REDEEM_SIG }), deps((REDEEM.blockTime + 14 * 60) * 1000));
        expect(fresh.status).toBe(200);
        const old = await handleCall(callRequest({ to: OTHER_NUMBER, lang: "en", signature: REDEEM_SIG }), deps((REDEEM.blockTime + 16 * 60) * 1000));
        expect(old.status).toBe(409);
        expect((await old.json()).error).toBe("too_old");
        const refused = await handleCall(callRequest({ to: OTHER_NUMBER, lang: "en", signature: REFUSED_SIG }), deps((REFUSED.blockTime + 60) * 1000));
        expect(refused.status).toBe(404);
        expect((await refused.json()).error).toBe("no_settled_payment");
      });
      expect(s.seen.vonage).toHaveLength(1);
    });
  });

  test("no settled payment is 404; a failed chain read is 502 chain_read_failed, never 404", async () => {
    await withStandIn({ history: [REFUSED, recorded.initializeVault] }, async (s) => {
      const r = await withEnv(callEnv(s.base), () => handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()));
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "no_settled_payment" });
    });
    const r = await withEnv(callEnv("http://127.0.0.1:9"), () => handleCall(callRequest({ to: NUMBER, lang: "en" }), deps()));
    expect(r.status).toBe(502);
    expect((await r.json()).error).toBe("chain_read_failed");
  });

  test("rate limited: the same number and payment a second time is 429 with Retry-After, and Vonage is not asked", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const d = deps();
        expect((await handleCall(callRequest({ to: NUMBER, lang: "en" }), d)).status).toBe(200);
        const second = await handleCall(callRequest({ to: NUMBER, lang: "en" }), d);
        expect(second.status).toBe(429);
        expect(second.headers.get("retry-after")).toBe(String(PAYMENT_MEMORY_MS / 1000));
        expect(await second.json()).toEqual({ error: "rate_limited", limit: "payment", retryAfterSeconds: PAYMENT_MEMORY_MS / 1000 });
      });
      expect(s.seen.vonage).toHaveLength(1);
    });
  });

  test("Vonage refusing: 502 call_failed with its title only, the number scrubbed, and the places given back", async () => {
    await withStandIn({ vonageStatus: 401, vonageTitle: `Unauthorized for 1${NATIONAL}` }, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const d = deps();
        const r = await handleCall(callRequest({ to: NUMBER, lang: "en" }), d);
        expect(r.status).toBe(502);
        const text = await r.text();
        expect(JSON.parse(text)).toEqual({ error: "call_failed", reason: "Unauthorized for [number]" });
        expect(text).not.toContain(NATIONAL);
        expect(text).not.toContain("detail for the test");
        // Released: the same number and payment may try again.
        expect((await handleCall(callRequest({ to: NUMBER, lang: "en" }), d)).status).toBe(502);
      });
      expect(s.seen.vonage).toHaveLength(2);
    });
    expect(safeTitle(`Bad number ${PLUS}1 (404) 555-0123 here`)).toBe("Bad number [number] here");
  });
});

// ---------- privacy: the number never reaches a log or a response ----------

test("the number never appears in console output across a full call path (want 0), while the capture works (want 1)", async () => {
  const PROBE = "capture-probe-7f3a";
  const captured: string[] = [];
  const restore = captureOutput(captured);
  const responses: string[] = [];
  let seenVonage: Array<{ body: unknown }> = [];
  try {
    console.log(PROBE);
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const d = deps();
        const ok = await handleCall(callRequest({ to: NUMBER, lang: "en" }), d);
        responses.push(await ok.clone().text());
        const audioUrl = (s.seen.vonage[0].body as { ncco: Array<{ streamUrl: string[] }> }).ncco[0].streamUrl[0];
        responses.push(String((await handleAudio(new Request(audioUrl), d)).status));
        // The refusals and failures on the way.
        for (const body of [{ to: NUMBER, lang: "en" }, { to: NUMBER, lang: "xx" }, { to: NUMBER, lang: "en", signature: REFUSED_SIG }]) {
          responses.push(await (await handleCall(callRequest(body), d)).text());
        }
        responses.push(await (await handleCall(new Request("http://x/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: `{"to":"${NUMBER}",` }), d)).text());
      });
      seenVonage = s.seen.vonage;
    });
    await withStandIn({ vonageStatus: 400, vonageTitle: "Bad Request" }, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        responses.push(await (await handleCall(callRequest({ to: OTHER_NUMBER, lang: "en" }), deps())).text());
      });
    });
  } finally {
    restore();
  }
  const output = captured.join("\n");
  const count = (needle: string) => output.split(needle).length - 1;
  expect(count(PROBE)).toBe(1);
  expect(count(NATIONAL)).toBe(0);
  expect(count("4045550199")).toBe(0);
  expect(count(NUMBER)).toBe(0);
  for (const r of responses) expect(r).not.toContain(NATIONAL);
  // The number did travel the path: the Vonage stand-in received it exactly once.
  expect(seenVonage.filter((v) => JSON.stringify(v.body).includes(`1${NATIONAL}`))).toHaveLength(1);
});

// ---------- helpers ----------

const STAND_IN_AUDIO = "ID3 unit-test stand-in audio";

function callEnv(base: string, extra: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: "test",
    VERCEL: undefined,
    LOKA_E2E_UPSTREAM: "1",
    SOLANA_RPC_URL: `${base}/rpc`,
    LOKA_VONAGE_APPLICATION_ID: "unit-test-application",
    LOKA_VONAGE_PRIVATE_KEY_B64: Buffer.from(PRIVATE_PEM).toString("base64"),
    LOKA_VONAGE_FROM_NUMBER: "12025550100",
    ELEVENLABS_API_KEY: "unit-test-elevenlabs-key",
    LOKA_CALL_SECRET: SECRET,
    LOKA_CALLS_OFF: undefined,
    LOKA_ELEVENLABS_VOICE_ID: undefined,
    LOKA_PUBLIC_ORIGIN: "http://127.0.0.1:3999",
    LOKA_VONAGE_API_URL: `${base}/vonage`,
    LOKA_ELEVENLABS_API_URL: `${base}/elevenlabs`,
    ...extra,
  };
}

function setEnv(vars: Record<string, string | undefined>): Record<string, string | undefined> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return before;
}

function withEnvSync<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const before = setEnv(vars);
  try {
    return run();
  } finally {
    setEnv(before);
  }
}

async function withEnv<T>(vars: Record<string, string | undefined>, run: () => T | Promise<T>): Promise<T> {
  const before = setEnv(vars);
  try {
    return await run();
  } finally {
    setEnv(before);
  }
}

/** Fresh caps and caches for each test, and a fixed clock (default: two minutes after the redeem settled). */
function deps(nowMs: number = (REDEEM.blockTime + 120) * 1000): CallDeps {
  return { now: () => nowMs, limits: new CallLimits(() => nowMs), chain: new ChainMemo(), audio: new AudioCache() };
}

function callRequest(body: unknown): Request {
  return new Request("http://x/api/call", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Collects everything written to the console, stdout and stderr; returns the function that restores them. */
function captureOutput(into: string[]): () => void {
  const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => void into.push(args.map(String).join(" "));
  const out = process.stdout.write.bind(process.stdout);
  const err = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => (into.push(String(chunk)), true)) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => (into.push(String(chunk)), true)) as typeof process.stderr.write;
  return () => {
    methods.forEach((m, i) => (console[m] = saved[i]));
    process.stdout.write = out;
    process.stderr.write = err;
  };
}

interface StandInOptions {
  /** The transactions getSignaturesForAddress lists, newest first. Default: every recorded one. */
  history?: unknown[];
  /** getTransaction for this signature answers a JSON-RPC error. */
  failTransaction?: string;
  vonageStatus?: number;
  vonageTitle?: string;
}

interface StandIn {
  base: string;
  seen: {
    rpc: string[];
    getTransaction: string[];
    vonage: Array<{ authorization: string; body: unknown }>;
    speech: Array<{ apiKey: string; voice: string; outputFormat: string | null; body: unknown }>;
  };
}

type Tx = { transaction: { signatures: string[] }; slot: number; blockTime: number | null; meta: { err: unknown } };

/** TEST FIXTURE: one local server standing in for devnet's JSON-RPC (/rpc), Vonage (/vonage) and ElevenLabs (/elevenlabs). */
async function withStandIn(options: StandInOptions, run: (s: StandIn) => Promise<void>): Promise<void> {
  const all = [REFUSED, REDEEM, recorded.registerMerchant, recorded.initializeVault, recorded.deploy] as Tx[];
  const history = (options.history ?? all) as Tx[];
  const seen: StandIn["seen"] = { rpc: [], getTransaction: [], vonage: [], speech: [] };
  const server: Server = createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.pathname === "/rpc") {
        const answer = (call: { id: number; method: string; params: unknown[] }) => {
          seen.rpc.push(call.method);
          if (call.method === "getSignaturesForAddress") {
            return {
              jsonrpc: "2.0",
              id: call.id,
              result: history.map((t) => ({ signature: t.transaction.signatures[0], slot: t.slot, err: t.meta.err, memo: null, blockTime: t.blockTime })),
            };
          }
          if (call.method === "getTransaction") {
            const sig = call.params[0] as string;
            seen.getTransaction.push(sig);
            if (sig === options.failTransaction) return { jsonrpc: "2.0", id: call.id, error: { code: -32005, message: "node is behind (test fixture)" } };
            return { jsonrpc: "2.0", id: call.id, result: all.find((t) => t.transaction.signatures[0] === sig) ?? null };
          }
          return { jsonrpc: "2.0", id: call.id, error: { code: -32601, message: "not in the test fixture" } };
        };
        const body = JSON.parse(raw);
        return json(200, Array.isArray(body) ? body.map(answer) : answer(body));
      }
      if (url.pathname === "/vonage/v1/calls") {
        seen.vonage.push({ authorization: req.headers.authorization ?? "", body: JSON.parse(raw) });
        if (options.vonageStatus && options.vonageStatus >= 300) {
          return json(options.vonageStatus, { type: "https://developer.nexmo.com/api-errors", title: options.vonageTitle ?? "Error", detail: "detail for the test" });
        }
        return json(201, { uuid: "unit-test-call", status: "started", direction: "outbound" });
      }
      const tts = url.pathname.match(/^\/elevenlabs\/v1\/text-to-speech\/(\w+)$/);
      if (tts) {
        const key = req.headers["xi-api-key"];
        seen.speech.push({ apiKey: typeof key === "string" ? key : "", voice: tts[1], outputFormat: url.searchParams.get("output_format"), body: JSON.parse(raw) });
        res.writeHead(200, { "content-type": "audio/mpeg" });
        return res.end(STAND_IN_AUDIO);
      }
      json(404, { message: "not found" });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run({ base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen });
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
