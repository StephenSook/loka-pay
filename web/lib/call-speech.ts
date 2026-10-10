// The words the phone call says (PLAN.md 3.9). Pure: the same payment, language and time always
// give the same text, which unit/call.test.ts checks. Only public payment details go in: the
// amount, when it settled and that the program checked the payer's signature. Never a
// phone number. ElevenLabs turns this text into the voice (lib/call-server.ts).
//
// English and French are written here. Wolof (PLAN.md 3.89) is not: its sentences, amount and
// time phrases come from WOLOF_SCRIPT in lib/call-wolof.ts, written by a native speaker, and
// speechFor("wo") throws until that script is complete.

import type { CallLang } from "./call-shared";
import { WOLOF, fillSlots, wolofScriptProblems, type WolofScript, type WolofSetup } from "./call-wolof";
import { MINT_DECIMALS } from "./vault";

/** The languages whose words are written in this file. */
type WrittenLang = Exclude<CallLang, "wo">;

export interface SpokenPayment {
  /** Mint base units as a decimal string (devnet USDC has 6 decimals). */
  amountUnits: string;
  /** The block time of the settlement, Unix seconds. */
  blockTime: number;
}

const UNITS_PER_CENT = BigInt(10) ** BigInt(MINT_DECIMALS - 2);
const CENTS_PER_DOLLAR = BigInt(100);

interface Money {
  dollars: bigint;
  cents: bigint;
  /** True when the base units were not a whole number of cents (rounded to the nearest cent). */
  rounded: boolean;
}

/** Base units to dollars and cents, rounding a fraction of a cent to the nearest cent. */
export function moneyOf(amountUnits: string): Money {
  if (!/^\d+$/.test(amountUnits)) throw new Error("an amount must be a whole number of base units");
  const units = BigInt(amountUnits);
  const rest = units % UNITS_PER_CENT;
  const totalCents = units / UNITS_PER_CENT + (rest * BigInt(2) >= UNITS_PER_CENT ? BigInt(1) : BigInt(0));
  return { dollars: totalCents / CENTS_PER_DOLLAR, cents: totalCents % CENTS_PER_DOLLAR, rounded: rest !== BigInt(0) };
}

const ONE = BigInt(1);
const ZERO = BigInt(0);

function amountWords(amountUnits: string, lang: WrittenLang): string {
  const { dollars, cents, rounded } = moneyOf(amountUnits);
  if (dollars === ZERO && cents === ZERO) return lang === "fr" ? "moins d'un cent" : "less than 1 cent";
  const parts: string[] = [];
  if (dollars > ZERO) parts.push(`${dollars} ${dollars === ONE ? "dollar" : "dollars"}`);
  if (cents > ZERO) parts.push(`${cents} ${cents === ONE ? "cent" : "cents"}`);
  const joined = parts.join(lang === "fr" ? " et " : " and ");
  if (!rounded) return joined;
  return lang === "fr" ? `environ ${joined}` : `about ${joined}`;
}

type Ago = { unit: "under a minute" } | { unit: "minute" | "hour" | "day"; n: number };

/** How long ago a time was: minutes under 2 hours, hours under 2 days, then days. */
function agoOf(settledAtMs: number, nowMs: number): Ago {
  const minutes = Math.max(0, Math.floor((nowMs - settledAtMs) / 60_000));
  if (minutes < 1) return { unit: "under a minute" };
  if (minutes < 120) return { unit: "minute", n: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return { unit: "hour", n: hours };
  return { unit: "day", n: Math.floor(hours / 24) };
}

/** How long ago a time was, for speech in English or French. */
export function agoWords(settledAtMs: number, nowMs: number, lang: WrittenLang): string {
  const ago = agoOf(settledAtMs, nowMs);
  const fr = lang === "fr";
  if (ago.unit === "under a minute") return fr ? "il y a moins d'une minute" : "less than a minute ago";
  const word = fr ? { minute: "minute", hour: "heure", day: "jour" }[ago.unit] : ago.unit;
  const plural = ago.n === 1 ? word : `${word}s`;
  return fr ? `il y a ${ago.n} ${plural}` : `${ago.n} ${plural} ago`;
}

/** A number for a Wolof {n}: Khadim's word for it when numberWords has one, else its digits. */
function wolofNumber(script: WolofScript, n: bigint | number): string {
  const digits = String(n);
  return Object.prototype.hasOwnProperty.call(script.numberWords, digits) ? script.numberWords[digits].trim() : digits;
}

/** The {amount} in Wolof, built the same way as amountWords from the script's amount phrases. */
function wolofAmount(amountUnits: string, script: WolofScript): string {
  const { dollars, cents, rounded } = moneyOf(amountUnits);
  const a = script.amount;
  if (dollars === ZERO && cents === ZERO) return fillSlots(a.lessThanOneCent, {});
  const parts: string[] = [];
  if (dollars > ZERO) parts.push(fillSlots(dollars === ONE ? a.oneDollar : a.dollars, { n: wolofNumber(script, dollars) }));
  if (cents > ZERO) parts.push(fillSlots(cents === ONE ? a.oneCent : a.cents, { n: wolofNumber(script, cents) }));
  const joined = parts.length === 2 ? fillSlots(a.dollarsAndCents, { dollars: parts[0], cents: parts[1] }) : parts[0];
  return rounded ? fillSlots(a.about, { amount: joined }) : joined;
}

/** The {ago} in Wolof, with the same thresholds as agoWords. */
function wolofAgo(settledAtMs: number, nowMs: number, script: WolofScript): string {
  const ago = agoOf(settledAtMs, nowMs);
  const t = script.ago;
  if (ago.unit === "under a minute") return fillSlots(t.lessThanAMinute, {});
  const n = { n: wolofNumber(script, ago.n) };
  if (ago.unit === "minute") return fillSlots(ago.n === 1 ? t.oneMinute : t.minutes, n);
  // Hours start at 2 and days at 2 (see agoOf), so neither needs a form for 1.
  return fillSlots(ago.unit === "hour" ? t.hours : t.days, n);
}

/** The Wolof call, from WOLOF_SCRIPT only. Throws while the script is not complete. */
function wolofSpeech(payment: SpokenPayment, nowMs: number, wolof: WolofSetup): string {
  const problems = wolofScriptProblems(wolof.script);
  if (problems.length > 0) throw new Error(`the Wolof script is not complete (${problems.length} problems): ${problems[0]}`);
  const s = wolof.script.sentences;
  return [
    fillSlots(s.hello, {}),
    fillSlots(s.whoIsCalling, {}),
    fillSlots(s.paymentSettled, {
      amount: wolofAmount(payment.amountUnits, wolof.script),
      ago: wolofAgo(payment.blockTime * 1000, nowMs, wolof.script),
    }),
    fillSlots(s.signatureChecked, {}),
    fillSlots(s.testMoney, {}),
    fillSlots(s.goodbye, {}),
  ].join(" ");
}

/**
 * The full text of the call. No em dash or en dash, by test. `wolof` is the Wolof script and its
 * gate (lib/call-wolof.ts); only a test passes its own.
 */
export function speechFor(payment: SpokenPayment, lang: CallLang, nowMs: number, wolof: WolofSetup = WOLOF): string {
  if (lang === "wo") return wolofSpeech(payment, nowMs, wolof);
  const amount = amountWords(payment.amountUnits, lang);
  const ago = agoWords(payment.blockTime * 1000, nowMs, lang);
  if (lang === "fr") {
    return [
      "Bonjour.",
      "Ceci est un appel de démonstration automatique de LOKA Pay, au hackathon Hacklanta, demandé sur zerobars point U S.",
      `Un paiement en bac à sable de ${amount} a été réglé sur Solana devnet ${ago}.`,
      "Avant de payer la boutique, la blockchain a vérifié la signature du payeur.",
      "C'est de l'argent de test, sans valeur réelle.",
      "Au revoir.",
    ].join(" ");
  }
  return [
    "Hello.",
    "This is an automated demo call from LOKA Pay at the Hacklanta hackathon, asked for on zerobars dot U S.",
    `A sandbox payment of ${amount} was settled on Solana devnet ${ago}.`,
    "Before paying the shop, the chain checked the payer's signature.",
    "This is test money with no real value.",
    "Goodbye.",
  ].join(" ");
}
