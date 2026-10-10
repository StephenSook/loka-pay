// The words the phone call says (PLAN.md 3.9). Pure: the same payment, language and time always
// give the same text, which unit/call.test.ts checks. Only public payment details go in: the
// amount, when it settled and that the program checked the payer phone's signature. Never a
// phone number. ElevenLabs turns this text into the voice (lib/call-server.ts).

import type { CallLang } from "./call-shared";
import { MINT_DECIMALS } from "./vault";

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

function amountWords(amountUnits: string, lang: CallLang): string {
  const { dollars, cents, rounded } = moneyOf(amountUnits);
  if (dollars === ZERO && cents === ZERO) return lang === "fr" ? "moins d'un cent" : "less than 1 cent";
  const parts: string[] = [];
  if (dollars > ZERO) parts.push(`${dollars} ${dollars === ONE ? "dollar" : "dollars"}`);
  if (cents > ZERO) parts.push(`${cents} ${cents === ONE ? "cent" : "cents"}`);
  const joined = parts.join(lang === "fr" ? " et " : " and ");
  if (!rounded) return joined;
  return lang === "fr" ? `environ ${joined}` : `about ${joined}`;
}

/** How long ago a time was, for speech: minutes under 2 hours, hours under 2 days, then days. */
export function agoWords(settledAtMs: number, nowMs: number, lang: CallLang): string {
  const minutes = Math.max(0, Math.floor((nowMs - settledAtMs) / 60_000));
  const fr = lang === "fr";
  if (minutes < 1) return fr ? "il y a moins d'une minute" : "less than a minute ago";
  const count = (n: number, en: string, frWord: string) => {
    const word = fr ? frWord : en;
    const plural = n === 1 ? word : `${word}s`;
    return fr ? `il y a ${n} ${plural}` : `${n} ${plural} ago`;
  };
  if (minutes < 120) return count(minutes, "minute", "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return count(hours, "hour", "heure");
  return count(Math.floor(hours / 24), "day", "jour");
}

/** The full text of the call. No em dash or en dash, by test. */
export function speechFor(payment: SpokenPayment, lang: CallLang, nowMs: number): string {
  const amount = amountWords(payment.amountUnits, lang);
  const ago = agoWords(payment.blockTime * 1000, nowMs, lang);
  if (lang === "fr") {
    return [
      "Bonjour.",
      "Ceci est un appel de démonstration automatique de LOKA Pay, au hackathon Hacklanta, demandé sur zerobars point U S.",
      `Un paiement en bac à sable de ${amount} a été réglé sur Solana devnet ${ago}.`,
      "Avant de payer la boutique, la blockchain a vérifié la signature créée par le téléphone du payeur.",
      "C'est de l'argent de test, sans valeur réelle.",
      "Au revoir.",
    ].join(" ");
  }
  return [
    "Hello.",
    "This is an automated demo call from LOKA Pay at the Hacklanta hackathon, asked for on zerobars dot U S.",
    `A sandbox payment of ${amount} was settled on Solana devnet ${ago}.`,
    "Before paying the shop, the chain checked the signature made by the payer's phone.",
    "This is test money with no real value.",
    "Goodbye.",
  ].join(" ");
}
