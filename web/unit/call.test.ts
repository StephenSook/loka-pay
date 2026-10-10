import { createPublicKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { encodeBase58 } from "../lib/base58";
import { numberKey, signAudioParams, verifyAudioParams, vonageJwt, type AudioParams } from "../lib/call-crypto";
import {
  CallLimits,
  DeskCodeFailures,
  FAILURE_LIMIT,
  FAILURE_WINDOW_MS,
  NUMBER_WINDOW_MS,
  PAYMENT_MEMORY_MS,
  SITE_LIMIT,
  SITE_WINDOW_MS,
  type LimitSettings,
} from "../lib/call-limits";
import { latestSettlement, settlementBySignature, settlementOf } from "../lib/call-payment";
import { AudioCache, ChainMemo, callConfig, clientKey, handleAudio, handleCall, safeTitle, type CallDeps } from "../lib/call-server";
import { isCallLang, isCallableUsNumber, isNewSettlement, isPlausibleSignature, normalizeUsNumber } from "../lib/call-shared";
import { agoWords, speechFor } from "../lib/call-speech";
import {
  WOLOF,
  WOLOF_REVIEWED_BY_NATIVE_SPEAKER,
  WOLOF_SCRIPT,
  acceptedCallLangs,
  fillSlots,
  offeredCallLangs,
  wolofScriptProblems,
  wolofScriptReady,
  wolofScriptUntouched,
  type WolofScript,
  type WolofSetup,
} from "../lib/call-wolof";
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
  test("only US geographic numbers in E.164 form pass", () => {
    // Atlanta's 404 and 678, New York's 212, Los Angeles' 213.
    for (const ok of [NUMBER, `${PLUS}16785550100`, `${PLUS}12125550100`, `${PLUS}12135550100`]) expect(isCallableUsNumber(ok), ok).toBe(true);
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
      expect(isCallableUsNumber(bad), String(bad)).toBe(false);
    }
  });

  test("non-US NANP, toll-free, premium and special numbers are refused", () => {
    const refused: Array<[string, string]> = [
      ["876", "Jamaica"],
      ["809", "Dominican Republic"],
      ["284", "British Virgin Islands"],
      ["242", "Bahamas"],
      ["441", "Bermuda"],
      ["787", "Puerto Rico (a US territory, outside the demo)"],
      ["671", "Guam"],
      ["416", "Toronto"],
      ["604", "Vancouver"],
      ["900", "premium"],
      ["976", "976 as an area code"],
      ["800", "toll-free"],
      ["888", "toll-free"],
      ["500", "personal services"],
      ["700", "carrier"],
      ["211", "N11"],
      ["290", "held for expansion"],
      ["370", "reserved"],
      ["960", "reserved"],
    ];
    for (const [area, what] of refused) expect(isCallableUsNumber(`${PLUS}1${area}5550100`), `${area} ${what}`).toBe(false);
    // Special exchanges inside a US area code: the 976 premium exchange, N11 and carrier codes.
    for (const exchange of ["976", "411", "911", "950", "958"]) expect(isCallableUsNumber(`${PLUS}1404${exchange}0100`), exchange).toBe(false);
    // The page normalizes through the same function, so it refuses the same numbers.
    expect(normalizeUsNumber("(876) 555-0100")).toBeNull();
    expect(normalizeUsNumber("1 900 555 0100")).toBeNull();
    expect(normalizeUsNumber("404 976 0100")).toBeNull();
    expect(normalizeUsNumber("(678) 555-0100")).toBe(`${PLUS}16785550100`);
  });

  test("the page and the server import the same validator, and no other file carries a number pattern", () => {
    const web = path.join(__dirname, "..");
    const panel = readFileSync(path.join(web, "components", "call-panel.tsx"), "utf8");
    const server = readFileSync(path.join(web, "lib", "call-server.ts"), "utf8");
    const shared = readFileSync(path.join(web, "lib", "call-shared.ts"), "utf8");
    expect(panel).toMatch(/import \{[^}]*\bnormalizeUsNumber\b[^}]*\} from "@\/lib\/call-shared";/);
    expect(server).toMatch(/import \{[^}]*\bisCallableUsNumber\b[^}]*\} from "\.\/call-shared";/);
    expect(server).toContain("if (!isCallableUsNumber(to))");
    expect(shared).toContain("return isCallableUsNumber(e164) ? e164 : null;");
    // The NANP shape lives in lib/call-shared.ts alone.
    const shape = "[2-9]\\d{2}";
    for (const file of [panel, server, readFileSync(path.join(web, "app", "call", "page.tsx"), "utf8")]) expect(file).not.toContain(shape);
    expect(shared).toContain(shape);
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

  test("lang is en, fr or wo (wo gated by lib/call-wolof.ts); a signature is base58 of 64 bytes", () => {
    expect(isCallLang("en")).toBe(true);
    expect(isCallLang("fr")).toBe(true);
    expect(isCallLang("wo")).toBe(true);
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
        "Before paying the shop, the chain checked the payer's signature. " +
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
        "Avant de payer la boutique, la blockchain a vérifié la signature du payeur. " +
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

// ---------- Wolof (PLAN.md 3.89) ----------

// TEST FIXTURE: bracketed placeholder tokens in every slot. They are NOT Wolof: only a native
// speaker (Khadim) writes the real script, in lib/call-wolof.ts. The tokens show which field and
// slot each piece of the composed text came from.
const TOKEN_SCRIPT: WolofScript = {
  optionLabel: "[label]",
  sentences: {
    hello: "[hello]",
    whoIsCalling: "[who]",
    paymentSettled: "[paid {amount} / {ago}]",
    signatureChecked: "[checked]",
    testMoney: "[test money]",
    goodbye: "[bye]",
  },
  amount: {
    lessThanOneCent: "[under a cent]",
    oneDollar: "[one dollar]",
    dollars: "[{n} dollars]",
    oneCent: "[one cent {n}]",
    cents: "[{n} cents]",
    dollarsAndCents: "{dollars} [plus] {cents}",
    about: "[about] {amount}",
  },
  ago: {
    lessThanAMinute: "[just now]",
    oneMinute: "[one minute]",
    minutes: "[{n} minutes]",
    hours: "[{n} hours]",
    days: "[{n} days]",
  },
  numberWords: {},
};

/** Every field of TOKEN_SCRIPT emptied: the state before Khadim writes anything. */
const EMPTY_SCRIPT: WolofScript = {
  optionLabel: "",
  sentences: Object.fromEntries(Object.keys(TOKEN_SCRIPT.sentences).map((k) => [k, ""])) as WolofScript["sentences"],
  amount: Object.fromEntries(Object.keys(TOKEN_SCRIPT.amount).map((k) => [k, ""])) as WolofScript["amount"],
  ago: Object.fromEntries(Object.keys(TOKEN_SCRIPT.ago).map((k) => [k, ""])) as WolofScript["ago"],
  numberWords: {},
};
const FIELD_COUNT = 1 + Object.keys(TOKEN_SCRIPT.sentences).length + Object.keys(TOKEN_SCRIPT.amount).length + Object.keys(TOKEN_SCRIPT.ago).length;

const EMPTY_GATED: WolofSetup = { script: EMPTY_SCRIPT, reviewed: false };
const FILLED_UNRATED: WolofSetup = { script: TOKEN_SCRIPT, reviewed: false };
const FILLED_RATED: WolofSetup = { script: TOKEN_SCRIPT, reviewed: true };

test.describe("Wolof: Khadim's script behind a native-speaker gate", () => {
  const settled = REDEEM.blockTime as number;
  const at = (minutes: number) => (settled + minutes * 60) * 1000;
  const wo = (units: string, minutes: number, setup: WolofSetup = FILLED_RATED) => speechFor({ amountUnits: units, blockTime: settled }, "wo", at(minutes), setup);

  test("an empty script: the page hides wo, the server refuses it, and speechFor('wo') throws, whatever the gate says", () => {
    expect(FIELD_COUNT).toBe(19);
    for (const setup of [EMPTY_GATED, { script: EMPTY_SCRIPT, reviewed: true }]) {
      expect(offeredCallLangs(setup)).toEqual(["en", "fr"]);
      expect(acceptedCallLangs(setup)).toEqual(["en", "fr"]);
      expect(() => wo("2500000", 3, setup)).toThrow(/the Wolof script is not complete \(19 problems\)/);
    }
    expect(wolofScriptUntouched(EMPTY_SCRIPT)).toBe(true);
    const problems = wolofScriptProblems(EMPTY_SCRIPT);
    expect(problems).toHaveLength(FIELD_COUNT);
    expect(problems).toContain("sentences.paymentSettled: empty");
    expect(problems).toContain("amount.dollarsAndCents: empty");
    expect(problems).toContain("ago.days: empty");
  });

  test("a complete script not yet rated: the server takes wo for one test call, and the page still hides it", () => {
    expect(wolofScriptProblems(TOKEN_SCRIPT)).toEqual([]);
    expect(wolofScriptReady(FILLED_UNRATED)).toBe(true);
    expect(acceptedCallLangs(FILLED_UNRATED)).toEqual(["en", "fr", "wo"]);
    expect(offeredCallLangs(FILLED_UNRATED)).toEqual(["en", "fr"]);
    expect(wo("2500000", 3, FILLED_UNRATED)).toBe(wo("2500000", 3, FILLED_RATED));
  });

  test("complete and rated: the page offers wo, and speechFor('wo') is the script with every slot filled", () => {
    expect(offeredCallLangs(FILLED_RATED)).toEqual(["en", "fr", "wo"]);
    const text = wo("2500000", 3);
    expect(text).toBe("[hello] [who] [paid [2 dollars] [plus] [50 cents] / [3 minutes]] [checked] [test money] [bye]");
    expect(text).not.toContain(EM_DASH);
    expect(text).not.toContain(EN_DASH);
    // The amount phrases, chosen exactly as the English ones are.
    expect(wo("100000", 5)).toContain("[paid [10 cents] / ");
    expect(wo("1000000", 5)).toContain("[paid [one dollar] / ");
    expect(wo("1010000", 5)).toContain("[paid [one dollar] [plus] [one cent 1] / ");
    expect(wo("12000000", 5)).toContain("[paid [12 dollars] / ");
    expect(wo("1234567", 5)).toContain("[paid [about] [one dollar] [plus] [23 cents] / ");
    expect(wo("4", 5)).toContain("[paid [under a cent] / ");
    // The time phrases, with the same thresholds as agoWords.
    expect(wo("100000", 0)).toContain(" / [just now]]");
    expect(wo("100000", 0.99)).toContain(" / [just now]]");
    expect(wo("100000", 1)).toContain(" / [one minute]]");
    expect(wo("100000", 119)).toContain(" / [119 minutes]]");
    expect(wo("100000", 120)).toContain(" / [2 hours]]");
    expect(wo("100000", 60 * 47)).toContain(" / [47 hours]]");
    expect(wo("100000", 60 * 48)).toContain(" / [2 days]]");
    // numberWords replaces the digits of the numbers it lists, and only those.
    const worded: WolofSetup = { script: { ...TOKEN_SCRIPT, numberWords: { "2": "[two]", "50": "[fifty]" } }, reviewed: true };
    expect(wo("2500000", 3, worded)).toContain("[paid [[two] dollars] [plus] [[fifty] cents] / [3 minutes]]");
    expect(wo("2500000", 2, worded)).toContain(" / [[two] minutes]]");
    // Spaces around a field are trimmed; the six sentences are joined with one space.
    const padded: WolofSetup = { script: { ...TOKEN_SCRIPT, sentences: { ...TOKEN_SCRIPT.sentences, hello: "  [hello]  " } }, reviewed: true };
    expect(wo("2500000", 3, padded)).toBe(text);
  });

  test("en and fr are the same text whatever the Wolof setup", () => {
    for (const lang of ["en", "fr"] as const) {
      const shipped = speechFor({ amountUnits: "2500000", blockTime: settled }, lang, at(3));
      for (const setup of [WOLOF, EMPTY_GATED, FILLED_UNRATED, FILLED_RATED]) {
        expect(speechFor({ amountUnits: "2500000", blockTime: settled }, lang, at(3), setup), lang).toBe(shipped);
      }
    }
    expect(speechFor({ amountUnits: "2500000", blockTime: settled }, "en", at(3), FILLED_RATED)).toContain("A sandbox payment of 2 dollars and 50 cents");
    expect(speechFor({ amountUnits: "2500000", blockTime: settled }, "fr", at(3), FILLED_RATED)).toContain("Un paiement en bac à sable de 2 dollars et 50 cents");
  });

  test("wolofScriptProblems names each slot that is missing, not allowed or broken", () => {
    const withField = <K extends "sentences" | "amount" | "ago">(section: K, key: keyof WolofScript[K], value: string): WolofScript => ({
      ...TOKEN_SCRIPT,
      [section]: { ...TOKEN_SCRIPT[section], [key]: value },
    });
    expect(wolofScriptProblems(withField("sentences", "paymentSettled", "[paid {amount}]"))).toEqual(["sentences.paymentSettled: needs {ago}"]);
    expect(wolofScriptProblems(withField("sentences", "hello", "[hello {amount}]"))).toEqual(["sentences.hello: {amount} is not a slot here"]);
    expect(wolofScriptProblems(withField("amount", "dollars", "[dollars]"))).toEqual(["amount.dollars: needs {n}"]);
    expect(wolofScriptProblems(withField("amount", "dollarsAndCents", "{dollars} {amount}"))).toEqual([
      "amount.dollarsAndCents: needs {cents}",
      "amount.dollarsAndCents: {amount} is not a slot here",
    ]);
    expect(wolofScriptProblems(withField("amount", "oneDollar", "[one {n}]"))).toEqual([]);
    expect(wolofScriptProblems(withField("ago", "minutes", `[{n}${EM_DASH}minutes]`))).toEqual(["ago.minutes: has an em dash or en dash"]);
    expect(wolofScriptProblems(withField("ago", "hours", `[{n}${EN_DASH}hours]`))).toEqual(["ago.hours: has an em dash or en dash"]);
    expect(wolofScriptProblems(withField("ago", "days", "[{n days]"))).toEqual(["ago.days: has a brace that is not part of a {slot}", "ago.days: needs {n}"]);
    expect(wolofScriptProblems(withField("sentences", "goodbye", "   "))).toEqual(["sentences.goodbye: empty"]);
    expect(wolofScriptProblems({ ...TOKEN_SCRIPT, optionLabel: "" })).toEqual(["optionLabel: empty"]);
    expect(wolofScriptProblems({ ...TOKEN_SCRIPT, numberWords: { "02": "[two]", "3": " ", "4": "{n}" } })).toEqual([
      'numberWords["3"]: empty',
      'numberWords["4"]: a number word takes no slots',
      'numberWords["02"]: the key must be a number\'s digits, like "12"',
    ]);
    // A half-filled script is neither untouched nor complete.
    const half = withField("sentences", "hello", "[hello]");
    expect(wolofScriptUntouched({ ...EMPTY_SCRIPT, sentences: { ...EMPTY_SCRIPT.sentences, hello: "[hello]" } })).toBe(false);
    expect(wolofScriptUntouched(half)).toBe(false);
    // A slot with no value is never read out as its name.
    expect(() => fillSlots("[paid {amount}]", {})).toThrow("no value for the slot {amount}");
    expect(fillSlots(" [paid {amount}] ", { amount: "{ago}" })).toBe("[paid {ago}]");
  });

  test("the shipped script is untouched or complete, and wo stays off the page until a native speaker rated a test call", () => {
    // Half a script fails here with the list of what is missing (docs/call-wolof-script.md, step 2).
    expect(wolofScriptUntouched(WOLOF_SCRIPT) ? [] : wolofScriptProblems(WOLOF_SCRIPT)).toEqual([]);
    // The gate cannot be set on an incomplete script.
    expect(WOLOF_REVIEWED_BY_NATIVE_SPEAKER ? wolofScriptProblems(WOLOF_SCRIPT) : []).toEqual([]);
    expect(WOLOF).toEqual({ script: WOLOF_SCRIPT, reviewed: WOLOF_REVIEWED_BY_NATIVE_SPEAKER });
    // Whatever the script holds, the page offers wo only with the gate set.
    expect(offeredCallLangs({ script: WOLOF_SCRIPT, reviewed: false })).toEqual(["en", "fr"]);
    expect(offeredCallLangs()).toEqual(WOLOF_REVIEWED_BY_NATIVE_SPEAKER ? ["en", "fr", "wo"] : ["en", "fr"]);
    expect(acceptedCallLangs()).toEqual(wolofScriptReady(WOLOF) ? ["en", "fr", "wo"] : ["en", "fr"]);
  });

  test("Wolof preview: the shipped script's text for sample payments, printed once it is complete", () => {
    const samples: Array<[string, number]> = [
      ["100000", 0],
      ["1000000", 1],
      ["1010000", 7],
      ["2500000", 119],
      ["1234567", 180],
      ["4", 60 * 72],
    ];
    if (!wolofScriptReady(WOLOF)) {
      // Still empty: nothing to preview, and nothing can be said.
      expect(() => wo("100000", 0, WOLOF)).toThrow(/the Wolof script is not complete/);
      return;
    }
    for (const [units, minutes] of samples) {
      const text = wo(units, minutes, WOLOF);
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toContain(EM_DASH);
      expect(text).not.toContain(EN_DASH);
      console.log(`[Wolof preview] ${units} base units, ${minutes} minutes ago: ${text}`);
    }
  });

  test("POST /api/call lang wo: refused while the script is empty; once complete, called and voiced with eleven_v4 and language_code wo", async () => {
    await withStandIn({}, async (s) => {
      const now = (REDEEM.blockTime + 7 * 60) * 1000;
      await withEnv(callEnv(s.base), async () => {
        // Empty script: refused before devnet, Vonage or ElevenLabs is asked.
        const refused = await handleCall(callRequest({ to: NUMBER, lang: "wo" }), { ...deps(now), wolof: EMPTY_GATED });
        expect(refused.status).toBe(400);
        expect(await refused.json()).toEqual({ error: "bad_lang", reason: "lang is en or fr" });
        expect(s.seen.rpc).toHaveLength(0);
        expect(s.seen.vonage).toHaveLength(0);

        // Complete, not yet rated: the hand-placed test call works.
        const d = { ...deps(now), wolof: FILLED_UNRATED };
        const r = await handleCall(callRequest({ to: NUMBER, lang: "wo" }), d);
        expect(r.status).toBe(200);
        expect(s.seen.vonage).toHaveLength(1);
        const audioUrl = new URL((s.seen.vonage[0].body as { ncco: Array<{ streamUrl: string[] }> }).ncco[0].streamUrl[0]);
        expect(verifyAudioParams(SECRET, audioUrl.searchParams.get("p"), audioUrl.searchParams.get("m"), now / 1000)).toMatchObject({ ok: true, params: { lang: "wo" } });
        const audio = await handleAudio(new Request(audioUrl.href), d);
        expect(audio.status).toBe(200);
        expect(s.seen.speech).toHaveLength(1);
        expect(s.seen.speech[0].body).toEqual({
          text: "[hello] [who] [paid [10 cents] / [7 minutes]] [checked] [test money] [bye]",
          model_id: "eleven_v4",
          language_code: "wo",
        });

        // The same signed link, served where the script is empty: no voice, ElevenLabs not asked.
        const empty = await handleAudio(new Request(audioUrl.href), { ...deps(now), wolof: EMPTY_GATED });
        expect(empty.status).toBe(502);
        expect(await empty.json()).toEqual({ error: "voice_failed" });
        expect(s.seen.speech).toHaveLength(1);

        // English (and French) send exactly the request they did before: no language_code.
        const en = { ...deps(now), wolof: FILLED_RATED };
        expect((await handleCall(callRequest({ to: OTHER_NUMBER, lang: "en" }), en)).status).toBe(200);
        const enUrl = (s.seen.vonage[1].body as { ncco: Array<{ streamUrl: string[] }> }).ncco[0].streamUrl[0];
        expect((await handleAudio(new Request(enUrl), en)).status).toBe(200);
        expect(s.seen.speech[1].body).toEqual({ text: speechFor({ amountUnits: "100000", blockTime: REDEEM.blockTime }, "en", now), model_id: "eleven_v4" });
      });
    });
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
  test("two reservations per number per 30 minutes, then rate limited until the oldest leaves the window", () => {
    let now = 1_000_000;
    const limits = new CallLimits(() => now);
    const key = numberKey(SECRET, NUMBER);
    expect(limits.reserve(key)).toEqual({ ok: true });
    now += 60_000;
    expect(limits.reserve(key)).toEqual({ ok: true });
    now += 60_000;
    expect(limits.reserve(key)).toEqual({ ok: false, limit: "number", retryAfterSeconds: (NUMBER_WINDOW_MS - 120_000) / 1000 });
    // A refused reservation takes nothing; another number is not affected.
    expect(limits.sizes()).toEqual({ numbers: 1, payments: 0, site: 2 });
    expect(limits.reserve(numberKey(SECRET, OTHER_NUMBER))).toEqual({ ok: true });
    now = 1_000_000 + NUMBER_WINDOW_MS;
    expect(limits.reserve(key)).toEqual({ ok: true });
  });

  test("one call per number and payment, remembered for 24 hours", () => {
    let now = 5_000_000;
    const limits = new CallLimits(() => now);
    const key = numberKey(SECRET, NUMBER);
    expect(limits.claimPayment(key, REDEEM_SIG)).toEqual({ ok: true });
    now += NUMBER_WINDOW_MS;
    expect(limits.claimPayment(key, REDEEM_SIG)).toEqual({ ok: false, limit: "payment", retryAfterSeconds: (PAYMENT_MEMORY_MS - NUMBER_WINDOW_MS) / 1000 });
    // The same payment for another number, and another payment for this number, are fine.
    expect(limits.claimPayment(numberKey(SECRET, OTHER_NUMBER), REDEEM_SIG)).toEqual({ ok: true });
    expect(limits.claimPayment(key, REFUSED_SIG)).toEqual({ ok: true });
    now = 5_000_000 + PAYMENT_MEMORY_MS;
    expect(limits.claimPayment(key, REDEEM_SIG)).toEqual({ ok: true });
  });

  test("at most 30 reservations an hour for the site (this instance); a full site takes no number slot", () => {
    let now = 9_000_000;
    const limits = new CallLimits(() => now);
    for (let i = 0; i < SITE_LIMIT; i += 1) {
      expect(limits.reserve(numberKey(SECRET, `${PLUS}1404555${String(i).padStart(4, "0")}`))).toEqual({ ok: true });
      now += 1000;
    }
    const fresh = numberKey(SECRET, OTHER_NUMBER);
    expect(limits.reserve(fresh)).toEqual({ ok: false, limit: "site", retryAfterSeconds: (SITE_WINDOW_MS - SITE_LIMIT * 1000) / 1000 });
    expect(limits.sizes()).toEqual({ numbers: SITE_LIMIT, payments: 0, site: SITE_LIMIT });
    now = 9_000_000 + SITE_WINDOW_MS;
    expect(limits.reserve(fresh)).toEqual({ ok: true });
  });

  test("desk-code failures: 10 per client in 10 minutes, then refused until the oldest leaves the window", () => {
    let now = 2_000_000;
    const failures = new DeskCodeFailures(() => now);
    for (let i = 0; i < FAILURE_LIMIT; i += 1) {
      expect(failures.check("client-a")).toEqual({ ok: true });
      failures.record("client-a");
    }
    expect(failures.check("client-a")).toEqual({ ok: false, limit: "desk_code", retryAfterSeconds: FAILURE_WINDOW_MS / 1000 });
    expect(failures.check("client-b")).toEqual({ ok: true });
    now += FAILURE_WINDOW_MS;
    expect(failures.check("client-a")).toEqual({ ok: true });
  });

  test("every map and cache stays at its maximum size", async () => {
    const now = 1_000;
    // A site cap high enough to reach the map bounds, so the bound itself is what is tested.
    const limits = new CallLimits(() => now, { siteLimit: 10_000, maxNumberKeys: 5, maxPaymentPairs: 7 });
    for (let i = 0; i < 40; i += 1) {
      const key = numberKey(SECRET, `${PLUS}1404555${String(i).padStart(4, "0")}`);
      expect(limits.reserve(key)).toEqual({ ok: true });
      expect(limits.claimPayment(key, REDEEM_SIG)).toEqual({ ok: true });
    }
    expect(limits.sizes()).toEqual({ numbers: 5, payments: 7, site: 40 });
    // The default site cap stops calls long before any bound matters.
    const real = new CallLimits(() => now);
    for (let i = 0; i < 200; i += 1) real.reserve(numberKey(SECRET, `${PLUS}1404555${String(i).padStart(4, "0")}`));
    expect(real.sizes()).toEqual({ numbers: SITE_LIMIT, payments: 0, site: SITE_LIMIT });

    const failures = new DeskCodeFailures(() => now, FAILURE_LIMIT, 6);
    for (let i = 0; i < 500; i += 1) failures.record(`client-${i}`);
    expect(failures.size).toBe(6);

    const memo = new ChainMemo(10_000, 4);
    for (let i = 0; i < 20; i += 1) memo.set(`sig-${i}`, now, null);
    expect(memo.size).toBe(4);
    // Expired entries leave on the next write.
    memo.set("fresh", now + 10_000, null);
    expect(memo.size).toBe(1);

    const audio = new AudioCache(3);
    for (let i = 0; i < 12; i += 1) await audio.get(`p-${i}`, now, now + 600_000, async () => new Uint8Array([i]));
    expect(audio.size).toBe(3);
    await audio.get("late", now + 600_000, now + 1_200_000, async () => new Uint8Array([1]));
    expect(audio.size).toBe(1);
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
          [callRequest({ to: `${PLUS}18765550100`, lang: "en" }), 400, "bad_number"],
          [callRequest({ to: `${PLUS}19005550100`, lang: "en" }), 400, "bad_number"],
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

  test("Vonage refusing: 502 call_failed with its title only, the number scrubbed, and the request stays counted", async () => {
    await withStandIn({ vonageStatus: 401, vonageTitle: `Unauthorized for 1${NATIONAL}` }, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const d = deps();
        const r = await handleCall(callRequest({ to: NUMBER, lang: "en" }), d);
        expect(r.status).toBe(502);
        const text = await r.text();
        expect(JSON.parse(text)).toEqual({ error: "call_failed", reason: "Unauthorized for [number]" });
        expect(text).not.toContain(NATIONAL);
        expect(text).not.toContain("detail for the test");
        // Failures count like calls: the same number and payment is not tried again.
        const again = await handleCall(callRequest({ to: NUMBER, lang: "en" }), d);
        expect(again.status).toBe(429);
        expect((await again.json()).limit).toBe("payment");
      });
      expect(s.seen.vonage).toHaveLength(1);
    });
    expect(safeTitle(`Bad number ${PLUS}1 (404) 555-0123 here`)).toBe("Bad number [number] here");
  });

  test("the same number and signature again, after the chain cache expires: 429 with zero devnet reads and no reservation", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        let now = (REDEEM.blockTime + 60) * 1000;
        const d: CallDeps = { ...deps(), now: () => now, limits: new CallLimits(() => now) };
        const body = { to: NUMBER, lang: "en", signature: REDEEM_SIG };
        expect((await handleCall(callRequest(body), d)).status).toBe(200);
        const reads = s.seen.rpc.length;
        expect(reads).toBeGreaterThan(0);
        const sizes = d.limits.sizes();
        // Past the 10 s chain cache, so only the early check can keep devnet out of it.
        now += 11_000;
        const again = await handleCall(callRequest(body), d);
        expect(again.status).toBe(429);
        expect((await again.json()).limit).toBe("payment");
        expect(s.seen.rpc).toHaveLength(reads);
        expect(d.limits.sizes()).toEqual(sizes);
        expect(s.seen.vonage).toHaveLength(1);
      });
    });
  });

  test("a flood beyond the caps makes zero devnet, ElevenLabs or Vonage requests", async () => {
    // A well-formed signature devnet does not know: every counted request reads devnet once.
    const unknown = encodeBase58(new Uint8Array(64).fill(7));
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base), async () => {
        const d = deps(undefined, { siteLimit: 5 });
        const ask = (to: string, signature?: string) => handleCall(callRequest({ to, lang: "en", ...(signature ? { signature } : {}) }), d);
        // The number's two slots each read devnet once, and find nothing.
        expect((await ask(NUMBER, unknown)).status).toBe(404);
        expect((await ask(NUMBER, unknown)).status).toBe(404);
        expect(s.seen.rpc).toHaveLength(2);
        // Fifty more from that number: refused before any read.
        for (let i = 0; i < 50; i += 1) expect((await ask(NUMBER, unknown)).status).toBe(429);
        expect(s.seen.rpc).toHaveLength(2);
        // The two failed requests kept their site slots; three calls fill this instance's cap (5 here)...
        expect(d.limits.sizes().site).toBe(2);
        for (let i = 0; i < 3; i += 1) expect((await ask(`${PLUS}1678555${String(i).padStart(4, "0")}`)).status).toBe(200);
        expect(s.seen.vonage).toHaveLength(3);
        expect(d.limits.sizes().site).toBe(5);
        const reads = s.seen.rpc.length;
        // ...then a hundred more numbers are refused before any read or call.
        for (let i = 0; i < 100; i += 1) {
          const r = await ask(`${PLUS}1213555${String(i).padStart(4, "0")}`);
          expect(r.status).toBe(429);
          expect((await r.json()).limit).toBe("site");
        }
        expect(s.seen.rpc).toHaveLength(reads);
      });
      expect(s.seen.vonage).toHaveLength(3);
      expect(s.seen.speech).toHaveLength(0);
    });
  });
});

// ---------- the desk code ----------

test.describe("desk code (LOKA_CALL_CODE)", () => {
  // Letters and digits, at least 8: valid on a deployment too (DEPLOYED_DESK_CODE).
  const CODE = "Desk2026Code";
  /** A request as Vercel's edge would pass it on: its own x-vercel-forwarded-for, and an x-forwarded-for the client may have written. */
  const fromClient = (address: string, body: unknown, spoofed = `${address}, 10.0.0.1`) =>
    new Request("http://x/api/call", {
      method: "POST",
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": address, "x-forwarded-for": spoofed },
      body: JSON.stringify(body),
    });

  test("missing or wrong: 403 wrong_code, with no devnet, ElevenLabs or Vonage request and no cap used; right: the call is placed", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base, { LOKA_CALL_CODE: CODE }), async () => {
        const d = deps();
        for (const body of [
          { to: NUMBER, lang: "en" },
          { to: NUMBER, lang: "en", code: "" },
          { to: NUMBER, lang: "en", code: "wrong" },
          { to: NUMBER, lang: "en", code: `${CODE} ` },
        ]) {
          const r = await handleCall(callRequest(body), d);
          expect(r.status, JSON.stringify(body.code)).toBe(403);
          expect((await r.json()).error).toBe("wrong_code");
        }
        expect(s.seen.rpc).toHaveLength(0);
        expect(s.seen.vonage).toHaveLength(0);
        expect(s.seen.speech).toHaveLength(0);
        expect(d.limits.sizes()).toEqual({ numbers: 0, payments: 0, site: 0 });
        expect((await handleCall(callRequest({ to: NUMBER, lang: "en", code: CODE }), d)).status).toBe(200);
        expect(s.seen.vonage).toHaveLength(1);
        // A code that is not text is a bad request, not a guess.
        expect((await handleCall(callRequest({ to: NUMBER, lang: "en", code: 1234 }), d)).status).toBe(400);
      });
      // Unset, no code is needed (local development).
      await withEnv(callEnv(s.base), async () => {
        expect((await handleCall(callRequest({ to: OTHER_NUMBER, lang: "en" }), deps())).status).toBe(200);
      });
    });
  });

  test("one client's flood of wrong codes ends in 429 and never stops another client's call", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base, { LOKA_CALL_CODE: CODE }), async () => {
        // A small site cap, so a wrong code counted against it would show here.
        const d = deps(undefined, { siteLimit: 5 });
        const A = "203.0.113.5";
        const B = "198.51.100.7";
        // Client A guesses with the judge's number: ten 403s, then its wrong codes get 429.
        for (let i = 0; i < FAILURE_LIMIT; i += 1) {
          expect((await handleCall(fromClient(A, { to: NUMBER, lang: "en", code: `guess-${i}` }), d)).status).toBe(403);
        }
        for (let i = 0; i < 20; i += 1) {
          const r = await handleCall(fromClient(A, { to: NUMBER, lang: "en", code: `guess-x${i}` }), d);
          expect(r.status).toBe(429);
          expect(r.headers.get("retry-after")).toBe(String(FAILURE_WINDOW_MS / 1000));
          expect(await r.json()).toEqual({ error: "rate_limited", limit: "desk_code", retryAfterSeconds: FAILURE_WINDOW_MS / 1000 });
        }
        // None of it touched the number or the site, or reached devnet or Vonage.
        expect(d.limits.sizes()).toEqual({ numbers: 0, payments: 0, site: 0 });
        expect(s.seen.rpc).toHaveLength(0);
        expect(s.seen.vonage).toHaveLength(0);
        // Client B, with the right code and the same number, gets its call.
        const b = await handleCall(fromClient(B, { to: NUMBER, lang: "en", code: CODE }), d);
        expect(b.status).toBe(200);
        expect(s.seen.vonage).toHaveLength(1);
        expect(JSON.stringify(s.seen.vonage[0].body)).toContain(`1${NATIONAL}`);
        // The limiter keeps a keyed hash per client, never the address.
        expect(d.failures.size).toBe(1);
      });
    });
    // Distinct addresses give distinct keys; the key never contains the address.
    const secret = randomBytes(32).toString("hex");
    const key = clientKey(fromClient("203.0.113.5", {}), secret);
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).not.toContain("203.0.113.5");
    expect(key).not.toBe(clientKey(fromClient("198.51.100.7", {}), secret));
    expect(key).toBe(clientKey(fromClient("203.0.113.5", {}), secret));
  });

  test("an address past its limit still gets its call with the correct code (a venue's shared Wi-Fi)", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base, { LOKA_CALL_CODE: CODE }), async () => {
        const d = deps();
        const VENUE = "203.0.113.50";
        for (let i = 0; i < FAILURE_LIMIT + 3; i += 1) await handleCall(fromClient(VENUE, { to: OTHER_NUMBER, lang: "en", code: `typo-${i}` }), d);
        // Past its limit: that address's wrong codes are refused.
        const wrong = await handleCall(fromClient(VENUE, { to: OTHER_NUMBER, lang: "en", code: "typo-again" }), d);
        expect(wrong.status).toBe(429);
        expect((await wrong.json()).limit).toBe("desk_code");
        // A judge on the same Wi-Fi with the correct code gets the call.
        const right = await handleCall(fromClient(VENUE, { to: NUMBER, lang: "en", code: CODE }), d);
        expect(right.status).toBe(200);
        expect(s.seen.vonage).toHaveLength(1);
        expect(JSON.stringify(s.seen.vonage[0].body)).toContain(`1${NATIONAL}`);
      });
    });
  });

  test("the limiter keys on Vercel's own header, not on x-forwarded-for a client can write", async () => {
    await withStandIn({}, async (s) => {
      await withEnv(callEnv(s.base, { LOKA_CALL_CODE: CODE, VERCEL_ENV: "production" }), async () => {
        const d = deps();
        // A different spoofed x-forwarded-for on every guess, one x-vercel-forwarded-for: one bucket.
        for (let i = 0; i < FAILURE_LIMIT; i += 1) {
          const r = await handleCall(fromClient("203.0.113.5", { to: NUMBER, lang: "en", code: `guess-${i}` }, `192.0.2.${i}`), d);
          expect(r.status).toBe(403);
        }
        expect(d.failures.size).toBe(1);
        const next = await handleCall(fromClient("203.0.113.5", { to: NUMBER, lang: "en", code: "guess-x" }, "192.0.2.200"), d);
        expect(next.status).toBe(429);
        expect((await next.json()).limit).toBe("desk_code");
        // x-real-ip when Vercel's header is missing.
        const realIp = (address: string, code: string) =>
          new Request("http://x/api/call", {
            method: "POST",
            headers: { "content-type": "application/json", "x-real-ip": address, "x-forwarded-for": "192.0.2.77" },
            body: JSON.stringify({ to: NUMBER, lang: "en", code }),
          });
        expect((await handleCall(realIp("198.51.100.20", "nope"), d)).status).toBe(403);
        expect(d.failures.size).toBe(2);
        // On a deployment, a request with neither header is refused, never put in a shared bucket.
        const bare = await handleCall(new Request("http://x/api/call", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.1" },
          body: JSON.stringify({ to: NUMBER, lang: "en", code: CODE }),
        }), d);
        expect(bare.status).toBe(400);
        expect(await bare.json()).toEqual({ error: "bad_request", reason: "the request carries no client address" });
        expect(d.failures.size).toBe(2);
        expect(s.seen.rpc).toHaveLength(0);
        expect(s.seen.vonage).toHaveLength(0);
      });
    });
    const secret = randomBytes(32).toString("hex");
    // Only an explicit local test run may use the one constant key.
    withEnvSync({ VERCEL: undefined, VERCEL_ENV: undefined, LOKA_CALL_TEST_MODE: "1" }, () => {
      expect(clientKey(callRequest({}), secret)).toMatch(/^[0-9a-f]{64}$/);
      expect(clientKey(callRequest({}), secret)).toBe(clientKey(callRequest({ other: 1 }), secret));
    });
    withEnvSync({ VERCEL: undefined, VERCEL_ENV: undefined, LOKA_CALL_TEST_MODE: undefined }, () =>
      expect(clientKey(callRequest({}), secret)).toBeNull(),
    );
    for (const platform of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" }, { VERCEL: "1" }]) {
      withEnvSync({ VERCEL: undefined, VERCEL_ENV: undefined, LOKA_CALL_TEST_MODE: "1", ...platform }, () =>
        expect(clientKey(callRequest({}), secret), JSON.stringify(platform)).toBeNull(),
      );
    }
  });
});

// ---------- the limits' end state, one row per rule ----------

test.describe("limits end state (table)", () => {
  const CODE = "Table2026Code";
  const A = "203.0.113.5";
  const B = "198.51.100.7";
  const UNKNOWN = encodeBase58(new Uint8Array(64).fill(9));

  interface Send {
    body?: unknown;
    raw?: string;
    client?: string;
  }
  interface Row {
    rule: string;
    env?: Record<string, string | undefined>;
    stand?: StandInOptions;
    settings?: Partial<LimitSettings>;
    nowMs?: number;
    /** Requests made before the one the row is about. */
    before?: Send[];
    send: Send;
    status: number;
    error?: string;
    limit?: string;
    /** Changes the request makes: limiter entries (failures: client keys; site: reservations; payments: pairs) and upstream requests. */
    failures: number;
    numbers: number;
    site: number;
    payments: number;
    /** "some" means at least one devnet request. */
    rpc: number | "some";
    vonage: number;
  }

  const ok = { to: NUMBER, lang: "en", code: CODE };
  const ROWS: Row[] = [
    { rule: "1 bad body", send: { raw: "{not json" }, status: 400, error: "bad_request", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "1 bad number (Jamaica, +1 876)", send: { body: { ...ok, to: `${PLUS}18765550100` } }, status: 400, error: "bad_number", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "2 calls off (LOKA_CALLS_OFF=1)", env: { LOKA_CALLS_OFF: "1" }, send: { body: ok }, status: 503, error: "calls_off", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "2 not configured (no ElevenLabs key)", env: { ELEVENLABS_API_KEY: undefined }, send: { body: ok }, status: 503, error: "calls_off", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "2 deployed without a desk code", env: { VERCEL_ENV: "production", LOKA_CALL_CODE: undefined }, send: { body: ok }, status: 503, error: "calls_off", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "2 no desk code and no test flag, with no platform variables", env: { LOKA_CALL_TEST_MODE: undefined, LOKA_CALL_CODE: undefined }, send: { body: ok }, status: 503, error: "calls_off", failures: 0, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "3 missing desk code", send: { body: { to: NUMBER, lang: "en" }, client: A }, status: 403, error: "wrong_code", failures: 1, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    { rule: "3 wrong desk code", send: { body: { ...ok, code: "nope" }, client: A }, status: 403, error: "wrong_code", failures: 1, numbers: 0, site: 0, payments: 0, rpc: 0, vonage: 0 },
    {
      rule: "3 an address past its threshold: its wrong codes get 429",
      before: Array.from({ length: FAILURE_LIMIT }, (_, i) => ({ body: { ...ok, code: `guess-${i}` }, client: A })),
      send: { body: { ...ok, code: "guess-again" }, client: A },
      status: 429,
      limit: "desk_code",
      failures: 0,
      numbers: 0,
      site: 0,
      payments: 0,
      rpc: 0,
      vonage: 0,
    },
    {
      rule: "3 the same address with the right code still gets its call",
      before: Array.from({ length: FAILURE_LIMIT + 5 }, (_, i) => ({ body: { ...ok, code: `guess-${i}` }, client: A })),
      send: { body: ok, client: A },
      status: 200,
      failures: 0,
      numbers: 1,
      site: 1,
      payments: 1,
      rpc: "some",
      vonage: 1,
    },
    {
      rule: "3 another client is not affected",
      before: Array.from({ length: FAILURE_LIMIT + 5 }, (_, i) => ({ body: { ...ok, code: `guess-${i}` }, client: A })),
      send: { body: ok, client: B },
      status: 200,
      failures: 0,
      numbers: 1,
      site: 1,
      payments: 1,
      rpc: "some",
      vonage: 1,
    },
    { rule: "4 right code, latest payment: reserved, then called", send: { body: ok }, status: 200, failures: 0, numbers: 1, site: 1, payments: 1, rpc: "some", vonage: 1 },
    { rule: "4 right code, unknown signature: reservation stays", send: { body: { ...ok, signature: UNKNOWN } }, status: 404, error: "no_settled_payment", failures: 0, numbers: 1, site: 1, payments: 0, rpc: "some", vonage: 0 },
    {
      rule: "4 right code, too old: reservation stays",
      nowMs: (REDEEM.blockTime + 16 * 60) * 1000,
      send: { body: { ...ok, signature: REDEEM_SIG } },
      status: 409,
      error: "too_old",
      failures: 0,
      numbers: 1,
      site: 1,
      payments: 0,
      rpc: "some",
      vonage: 0,
    },
    {
      rule: "4 right code, devnet error: reservation stays",
      stand: { failTransaction: REDEEM_SIG },
      send: { body: { ...ok, signature: REDEEM_SIG } },
      status: 502,
      error: "chain_read_failed",
      failures: 0,
      numbers: 1,
      site: 1,
      payments: 0,
      rpc: "some",
      vonage: 0,
    },
    {
      rule: "4 right code, Vonage refuses: reservation stays",
      stand: { vonageStatus: 401, vonageTitle: "Unauthorized" },
      send: { body: ok },
      status: 502,
      error: "call_failed",
      failures: 0,
      numbers: 1,
      site: 1,
      payments: 1,
      rpc: "some",
      vonage: 1,
    },
    {
      rule: "5 a number's third request in 30 minutes",
      before: [{ body: { ...ok, signature: UNKNOWN } }, { body: { ...ok, signature: UNKNOWN } }],
      send: { body: ok },
      status: 429,
      limit: "number",
      failures: 0,
      numbers: 0,
      site: 0,
      payments: 0,
      rpc: 0,
      vonage: 0,
    },
    {
      rule: "5 the site's 31st request in an hour",
      before: Array.from({ length: SITE_LIMIT }, (_, i) => ({ body: { ...ok, to: `${PLUS}1678555${String(i).padStart(4, "0")}`, signature: UNKNOWN } })),
      send: { body: ok },
      status: 429,
      limit: "site",
      failures: 0,
      numbers: 0,
      site: 0,
      payments: 0,
      rpc: 0,
      vonage: 0,
    },
    {
      rule: "5 the same number and signature again: refused before any reservation or read",
      before: [{ body: { ...ok, signature: REDEEM_SIG } }],
      send: { body: { ...ok, signature: REDEEM_SIG } },
      status: 429,
      limit: "payment",
      failures: 0,
      numbers: 0,
      site: 0,
      payments: 0,
      rpc: 0,
      vonage: 0,
    },
    {
      rule: "5 one call per number and payment",
      before: [{ body: ok }],
      send: { body: ok },
      status: 429,
      limit: "payment",
      failures: 0,
      numbers: 0,
      site: 1,
      payments: 0,
      rpc: 0,
      vonage: 0,
    },
  ];

  test("every rule, against the stand-ins", async () => {
    for (const row of ROWS) {
      await withStandIn(row.stand ?? {}, async (s) => {
        await withEnv(callEnv(s.base, { LOKA_CALL_CODE: CODE, ...row.env }), async () => {
          const d = deps(row.nowMs, row.settings);
          const send = (m: Send) =>
            handleCall(
              new Request("http://x/api/call", {
                method: "POST",
                headers: { "content-type": "application/json", ...(m.client ? { "x-vercel-forwarded-for": m.client } : {}) },
                body: m.raw ?? JSON.stringify(m.body),
              }),
              d,
            );
          for (const m of row.before ?? []) await send(m);
          const sizes = d.limits.sizes();
          const failures = d.failures.size;
          const seen = { rpc: s.seen.rpc.length, vonage: s.seen.vonage.length, speech: s.seen.speech.length };

          const r = await send(row.send);
          const body = await r.json();
          expect(r.status, row.rule).toBe(row.status);
          if (row.error) expect(body.error, row.rule).toBe(row.error);
          if (row.limit) expect(body.limit, row.rule).toBe(row.limit);
          const after = d.limits.sizes();
          expect(
            {
              failures: d.failures.size - failures,
              numbers: after.numbers - sizes.numbers,
              site: after.site - sizes.site,
              payments: after.payments - sizes.payments,
              vonage: s.seen.vonage.length - seen.vonage,
              speech: s.seen.speech.length - seen.speech,
            },
            row.rule,
          ).toEqual({ failures: row.failures, numbers: row.numbers, site: row.site, payments: row.payments, vonage: row.vonage, speech: 0 });
          const reads = s.seen.rpc.length - seen.rpc;
          if (row.rpc === "some") expect(reads, row.rule).toBeGreaterThan(0);
          else expect(reads, row.rule).toBe(row.rpc);
          expect(JSON.stringify(body), row.rule).not.toContain(NATIONAL);
        });
      });
    }
    // 6: every map is bounded (each also expires with its window; see the caps tests).
    const now = 1_000;
    const limits = new CallLimits(() => now, { siteLimit: 1_000_000, maxNumberKeys: 3, maxPaymentPairs: 3 });
    const failures = new DeskCodeFailures(() => now, FAILURE_LIMIT, 3);
    const memo = new ChainMemo(10_000, 3);
    const audio = new AudioCache(3);
    for (let i = 0; i < 50; i += 1) {
      const key = numberKey(SECRET, `${PLUS}1404555${String(i).padStart(4, "0")}`);
      limits.reserve(key);
      limits.claimPayment(key, REDEEM_SIG);
      failures.record(`client-${i}`);
      memo.set(`sig-${i}`, now, null);
      await audio.get(`p-${i}`, now, now + 600_000, async () => new Uint8Array([1]));
    }
    expect({ ...limits.sizes(), site: 0, failures: failures.size, memo: memo.size, audio: audio.size }).toEqual({
      numbers: 3,
      payments: 3,
      site: 0,
      failures: 3,
      memo: 3,
      audio: 3,
    });
  });
});

test.describe("the desk code fails closed on Vercel", () => {
  for (const vercelEnv of ["production", "preview"]) {
    test(`VERCEL_ENV=${vercelEnv}: no code, a short code or one that is not letters and digits turns calls off; 8 letters and digits work`, async () => {
      await withStandIn({}, async (s) => {
        for (const code of [undefined, "", "1234", "123456", "abc1234", "abcdefgh", "12345678", "abcd-1234", "abcd 1234"]) {
          const r = await withEnv(callEnv(s.base, { VERCEL_ENV: vercelEnv, LOKA_CALL_CODE: code }), () =>
            handleCall(callRequest({ to: NUMBER, lang: "en", code: code ?? "x" }), deps()),
          );
          expect(r.status, String(code)).toBe(503);
          expect(await r.json(), String(code)).toEqual({ error: "calls_off", reason: "not set: LOKA_CALL_CODE" });
        }
        expect(s.seen.rpc).toHaveLength(0);
        const r = await withEnv(callEnv(s.base, { VERCEL_ENV: vercelEnv, LOKA_CALL_CODE: "abcd1234" }), () =>
          handleCall(
            new Request("http://x/api/call", {
              method: "POST",
              headers: { "content-type": "application/json", "x-vercel-forwarded-for": "203.0.113.9" },
              body: JSON.stringify({ to: NUMBER, lang: "en", code: "abcd1234" }),
            }),
            deps(),
          ),
        );
        expect(r.status).toBe(200);
        expect(s.seen.vonage).toHaveLength(1);
      });
    });
  }

  test("provider settings without a desk code and without the test flag: calls off, whatever the platform variables say", async () => {
    await withStandIn({}, async (s) => {
      // No VERCEL, no VERCEL_ENV (a host may hide them), no LOKA_CALL_TEST_MODE.
      for (const code of [undefined, "abc", "desk-code-1234"]) {
        const r = await withEnv(callEnv(s.base, { LOKA_CALL_TEST_MODE: undefined, LOKA_CALL_CODE: code }), () =>
          handleCall(callRequest({ to: NUMBER, lang: "en", code: code ?? "x" }), deps()),
        );
        expect(r.status, String(code)).toBe(503);
        expect(await r.json(), String(code)).toEqual({ error: "calls_off", reason: "not set: LOKA_CALL_CODE" });
      }
      expect(s.seen.rpc).toHaveLength(0);
      // A valid code turns them on.
      const config = await withEnv(callEnv(s.base, { LOKA_CALL_TEST_MODE: undefined, LOKA_CALL_CODE: "abcd1234" }), () => callConfig());
      expect(config.ok).toBe(true);
    });
  });

  test("the test flag skips the code only on a local run: with VERCEL or VERCEL_ENV set it still needs one", async () => {
    await withStandIn({}, async (s) => {
      // Local, even with NODE_ENV=production (the e2e build): no code needed.
      const local = await withEnv(callEnv(s.base, { NODE_ENV: "production", LOKA_CALL_TEST_MODE: "1", LOKA_CALL_CODE: undefined }), () => callConfig());
      expect(local.ok).toBe(true);
      for (const platform of [{ VERCEL: "1" }, { VERCEL_ENV: "development" }, { VERCEL_ENV: "preview" }]) {
        const off = await withEnv(callEnv(s.base, { ...platform, LOKA_CALL_TEST_MODE: "1", LOKA_CALL_CODE: undefined }), () => callConfig());
        expect(off, JSON.stringify(platform)).toEqual({ ok: false, reason: "not set: LOKA_CALL_CODE" });
        const on = await withEnv(callEnv(s.base, { ...platform, LOKA_CALL_TEST_MODE: "1", LOKA_CALL_CODE: "abcd1234" }), () => callConfig());
        expect(on.ok, JSON.stringify(platform)).toBe(true);
      }
      // Only "1" turns it on.
      const yes = await withEnv(callEnv(s.base, { LOKA_CALL_TEST_MODE: "true", LOKA_CALL_CODE: undefined }), () => callConfig());
      expect(yes.ok).toBe(false);
    });
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
    VERCEL_ENV: undefined,
    LOKA_CALL_CODE: undefined,
    // An explicit local test run: no desk code needed unless a test sets one.
    LOKA_CALL_TEST_MODE: "1",
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
function deps(nowMs: number = (REDEEM.blockTime + 120) * 1000, settings: Partial<LimitSettings> = {}): CallDeps {
  return {
    now: () => nowMs,
    limits: new CallLimits(() => nowMs, settings),
    failures: new DeskCodeFailures(() => nowMs),
    clientSecret: randomBytes(32).toString("hex"),
    chain: new ChainMemo(),
    audio: new AudioCache(),
  };
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
