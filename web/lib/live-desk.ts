// /live at the judge desk (PLAN.md 3.84): what a row says before its details arrive. Pure
// functions over lib/program-feed.ts rows, unit-tested in unit/live-desk.test.ts.
//
// A failed row is named from devnet's error code as soon as the signature list arrives
// (lib/program-errors.ts), so a refusal reads "SerialUsed (6011)" while its details are still
// queued under devnet's rate limit; the program's own log line, once read, wins. Raw error JSON
// is never shown.

import type { ProgramError } from "./logs";
import type { Row } from "./program-feed";
import { describeTxError, programErrorOf } from "./program-errors";

/** devnet's `err` field back from a row's errText (it is JSON.stringify of that field), or undefined. */
function errOf(row: Pick<Row, "errText">): unknown {
  if (row.errText === null) return undefined;
  try {
    return JSON.parse(row.errText);
  } catch {
    return undefined;
  }
}

export type Refusal =
  /** The program's error, from its log line (details read) or its error code (before details). */
  | { kind: "program"; error: ProgramError; fromLogs: boolean }
  /** Any other failure, in words (lib/program-errors.ts describeTxError). */
  | { kind: "words"; words: string };

/** Why a failed row failed, for the page to show. Null for a row that did not fail. */
export function refusalOf(row: Pick<Row, "result" | "error" | "errText">): Refusal | null {
  if (row.result !== "failed") return null;
  if (row.error) return { kind: "program", error: row.error, fromLogs: true };
  const err = errOf(row);
  const error = programErrorOf(err);
  if (error) return { kind: "program", error, fromLogs: false };
  return { kind: "words", words: describeTxError(err) };
}

/** One line for a refusal: "SerialUsed (6011): This allowance serial was already redeemed." */
export function refusalWords(refusal: Refusal): string {
  return refusal.kind === "program" ? `${refusal.error.name} (${refusal.error.number}): ${refusal.error.message}.` : refusal.words;
}
