// Wolof for the phone call (PLAN.md 3.89). Pure and client-safe: no environment, no network.
//
// ONLY A NATIVE SPEAKER WRITES THE WOLOF IN THIS FILE (Khadim). Nobody else writes, guesses or
// machine-translates a Wolof sentence here, and no tool fills these slots in. The English text
// each slot stands for, and the steps, are in docs/call-wolof-script.md.
//
// Two switches, in this order:
// 1. WOLOF_SCRIPT complete: every slot filled and wolofScriptProblems() empty. Then the server
//    takes lang "wo" on POST /api/call, so one real test call can be placed by hand. The /call
//    page still does not show Wolof.
// 2. WOLOF_REVIEWED_BY_NATIVE_SPEAKER = true, set only after Khadim heard a real test call and
//    rated it understandable. Then the /call page shows Wolof in its language menu.
// While WOLOF_SCRIPT is empty, the server refuses lang "wo" and speechFor("wo") throws, so an
// empty or half-written script can never be read to anyone.

import type { CallLang } from "./call-shared";

/**
 * The words of the call in Wolof. A slot is written {name}; each field below says which slots it
 * takes. Everything else is plain text, with no em dash or en dash and no other braces.
 */
export interface WolofScript {
  /** What the /call language menu shows for Wolof, written the way Wolof speakers name it. No slots. */
  optionLabel: string;
  /** The six sentences of the call, in order (English: lib/call-speech.ts, speechFor). */
  sentences: {
    /** "Hello." No slots. */
    hello: string;
    /** "This is an automated demo call from LOKA Pay at the Hacklanta hackathon, asked for on zerobars dot U S." No slots. */
    whoIsCalling: string;
    /** "A sandbox payment of {amount} was settled on Solana devnet {ago}." Needs {amount} and {ago}. */
    paymentSettled: string;
    /** "Before paying the shop, the chain checked the payer's signature." No slots. */
    signatureChecked: string;
    /** "This is test money with no real value." No slots. */
    testMoney: string;
    /** "Goodbye." No slots. */
    goodbye: string;
  };
  /** The {amount} of sentences.paymentSettled. */
  amount: {
    /** "less than 1 cent", when the amount rounds to 0 cents. No slots. */
    lessThanOneCent: string;
    /** "1 dollar". {n} is optional (it is 1). */
    oneDollar: string;
    /** "{n} dollars", 2 or more. Needs {n}. */
    dollars: string;
    /** "1 cent". {n} is optional (it is 1). */
    oneCent: string;
    /** "{n} cents", 2 to 99. Needs {n}. */
    cents: string;
    /** "{dollars} and {cents}": both parts filled from the four fields above. Needs {dollars} and {cents}. */
    dollarsAndCents: string;
    /** "about {amount}", when the base units were not a whole number of cents. Needs {amount}. */
    about: string;
  };
  /** The {ago} of sentences.paymentSettled: minutes under 2 hours, hours under 2 days, then days. */
  ago: {
    /** "less than a minute ago". No slots. */
    lessThanAMinute: string;
    /** "1 minute ago". {n} is optional (it is 1). */
    oneMinute: string;
    /** "{n} minutes ago", 2 to 119. Needs {n}. */
    minutes: string;
    /** "{n} hours ago", 2 to 47. Needs {n}. */
    hours: string;
    /** "{n} days ago", 2 or more. Needs {n}. */
    days: string;
  };
  /**
   * Optional words for numbers, keyed by the number's digits: {"2": "..."}. A number listed here
   * is said with its word in every {n}; any other number goes in as digits (for example 12).
   * Leave it empty unless the test call shows the voice reads digits badly.
   */
  numberWords: Readonly<Record<string, string>>;
}

// =====================================================================================
// KHADIM FILLS IN THIS BLOCK. Native-speaker text only: never machine-translated.
// Leave a field "" until you have written it. A half-filled script fails CI on purpose,
// so fill every field in one change. Steps: docs/call-wolof-script.md.
// =====================================================================================

export const WOLOF_SCRIPT: WolofScript = {
  optionLabel: "",
  sentences: {
    hello: "",
    whoIsCalling: "",
    paymentSettled: "",
    signatureChecked: "",
    testMoney: "",
    goodbye: "",
  },
  amount: {
    lessThanOneCent: "",
    oneDollar: "",
    dollars: "",
    oneCent: "",
    cents: "",
    dollarsAndCents: "",
    about: "",
  },
  ago: {
    lessThanAMinute: "",
    oneMinute: "",
    minutes: "",
    hours: "",
    days: "",
  },
  numberWords: {},
};

/**
 * Set to true only after Khadim heard one real test call in Wolof and rated it understandable
 * (docs/call-wolof-script.md, step 5). True shows Wolof on the /call page.
 */
export const WOLOF_REVIEWED_BY_NATIVE_SPEAKER = false;

// =====================================================================================
// End of the block Khadim fills in.
// =====================================================================================

/** A script and its gate. The server and the page use WOLOF; a test may pass its own. */
export interface WolofSetup {
  script: WolofScript;
  reviewed: boolean;
}

export const WOLOF: WolofSetup = { script: WOLOF_SCRIPT, reviewed: WOLOF_REVIEWED_BY_NATIVE_SPEAKER };

interface SlotRule {
  /** Slots the field must contain. */
  needs: readonly string[];
  /** Slots the field may contain (includes `needs`). */
  allows: readonly string[];
}

const NONE: SlotRule = { needs: [], allows: [] };
const rule = (needs: string[], optional: string[] = []): SlotRule => ({ needs, allows: [...needs, ...optional] });

type SectionRules<T> = { readonly [K in keyof T]: SlotRule };

/** Which slots each field needs and may contain. lib/call-speech.ts fills exactly these. */
export const WOLOF_SLOTS: {
  optionLabel: SlotRule;
  sentences: SectionRules<WolofScript["sentences"]>;
  amount: SectionRules<WolofScript["amount"]>;
  ago: SectionRules<WolofScript["ago"]>;
} = {
  optionLabel: NONE,
  sentences: {
    hello: NONE,
    whoIsCalling: NONE,
    paymentSettled: rule(["amount", "ago"]),
    signatureChecked: NONE,
    testMoney: NONE,
    goodbye: NONE,
  },
  amount: {
    lessThanOneCent: NONE,
    oneDollar: rule([], ["n"]),
    dollars: rule(["n"]),
    oneCent: rule([], ["n"]),
    cents: rule(["n"]),
    dollarsAndCents: rule(["dollars", "cents"]),
    about: rule(["amount"]),
  },
  ago: {
    lessThanAMinute: NONE,
    oneMinute: rule([], ["n"]),
    minutes: rule(["n"]),
    hours: rule(["n"]),
    days: rule(["n"]),
  },
};

/** A slot as written in a field: a brace, a name, a brace. Used with replace and matchAll only. */
const SLOT = /\{([A-Za-z]+)\}/g;

/**
 * A field with its {slots} filled in, trimmed. Every slot in the field must have a value, or
 * this throws: a slot name read out loud would be worse than no call.
 */
export function fillSlots(template: string, values: Readonly<Record<string, string>>): string {
  return template.trim().replace(SLOT, (_whole, name: string) => {
    const value = values[name];
    if (value === undefined) throw new Error(`no value for the slot {${name}}`);
    return value;
  });
}

const DASHES = [String.fromCharCode(0x2014), String.fromCharCode(0x2013)];

function textProblems(where: string, text: string): string[] {
  const problems: string[] = [];
  if (DASHES.some((d) => text.includes(d))) problems.push(`${where}: has an em dash or en dash`);
  if (text.replace(SLOT, "").match(/[{}]/)) problems.push(`${where}: has a brace that is not part of a {slot}`);
  return problems;
}

function fieldProblems(where: string, text: string, slots: SlotRule): string[] {
  if (text.trim() === "") return [`${where}: empty`];
  const problems = textProblems(where, text);
  const used = [...text.matchAll(SLOT)].map((m) => m[1]);
  for (const name of slots.needs) if (!used.includes(name)) problems.push(`${where}: needs {${name}}`);
  for (const name of new Set(used)) if (!slots.allows.includes(name)) problems.push(`${where}: {${name}} is not a slot here`);
  return problems;
}

function sectionProblems<T extends Record<string, string>>(section: string, values: T, rules: SectionRules<T>): string[] {
  return (Object.keys(rules) as Array<keyof T & string>).flatMap((key) => fieldProblems(`${section}.${key}`, values[key] ?? "", rules[key]));
}

/** Everything still missing or wrong in a script; empty means the script is complete. */
export function wolofScriptProblems(script: WolofScript): string[] {
  const problems = [
    ...fieldProblems("optionLabel", script.optionLabel, WOLOF_SLOTS.optionLabel),
    ...sectionProblems("sentences", script.sentences, WOLOF_SLOTS.sentences),
    ...sectionProblems("amount", script.amount, WOLOF_SLOTS.amount),
    ...sectionProblems("ago", script.ago, WOLOF_SLOTS.ago),
  ];
  for (const [key, word] of Object.entries(script.numberWords)) {
    const where = `numberWords["${key}"]`;
    if (!/^(0|[1-9]\d*)$/.test(key)) problems.push(`${where}: the key must be a number's digits, like "12"`);
    if (word.trim() === "") problems.push(`${where}: empty`);
    else problems.push(...textProblems(where, word), ...(word.match(SLOT) ? [`${where}: a number word takes no slots`] : []));
  }
  return problems;
}

/** True when nothing in the script has been filled in yet (the shipped state before Khadim's change). */
export function wolofScriptUntouched(script: WolofScript): boolean {
  const fields = [script.optionLabel, ...Object.values(script.sentences), ...Object.values(script.amount), ...Object.values(script.ago)];
  return fields.every((f) => f === "") && Object.keys(script.numberWords).length === 0;
}

/** The script is complete: the server takes lang "wo" and speechFor("wo") can speak. */
export function wolofScriptReady(setup: WolofSetup): boolean {
  return wolofScriptProblems(setup.script).length === 0;
}

/** Complete and rated understandable after a real test call: the /call page shows Wolof. */
export function wolofOffered(setup: WolofSetup): boolean {
  return setup.reviewed === true && wolofScriptReady(setup);
}

/** The languages POST /api/call takes. */
export function acceptedCallLangs(setup: WolofSetup = WOLOF): CallLang[] {
  return wolofScriptReady(setup) ? ["en", "fr", "wo"] : ["en", "fr"];
}

/** The languages the /call page's menu shows, in order. */
export function offeredCallLangs(setup: WolofSetup = WOLOF): CallLang[] {
  return wolofOffered(setup) ? ["en", "fr", "wo"] : ["en", "fr"];
}
