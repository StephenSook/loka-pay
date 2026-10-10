// /live at the judge desk (PLAN.md 3.84): what a row says before its details arrive, and the
// kiosk's "Last payment" line. Pure functions over lib/program-feed.ts rows, unit-tested in
// unit/live-desk.test.ts. The labels for recorded rows are lib/row-labels.ts (server side, since
// they read docs/FACTS.json).
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

export type LastPayment =
  | { kind: "paid"; row: Row; amountUnits: string | null; newerReading: number }
  | { kind: "refused"; row: Row; refusal: Refusal; newerReading: number }
  | { kind: "unknown"; row: Row; newerReading: number }
  /** No redeem_note among the rows read so far; `reading` rows may still turn out to be one. */
  | { kind: "none"; reading: number };

/**
 * The newest payment among the rows (newest first, as the feed keeps them): the first row whose
 * instructions include redeem_note. A row whose details are still being read cannot be told
 * apart yet: rows like that above the payment are counted in `newerReading`, and with no payment
 * found, in `reading`.
 */
export function lastPayment(rows: readonly Row[]): LastPayment {
  let reading = 0;
  for (const row of rows) {
    if (!row.actions.includes("redeem_note")) {
      if (row.details === "reading") reading += 1;
      continue;
    }
    if (row.result === "succeeded") {
      const redeemed = row.amounts.find((a) => a.label === "Note redeemed");
      return { kind: "paid", row, amountUnits: redeemed ? redeemed.units : null, newerReading: reading };
    }
    const refusal = refusalOf(row);
    if (refusal) return { kind: "refused", row, refusal, newerReading: reading };
    return { kind: "unknown", row, newerReading: reading };
  }
  return { kind: "none", reading };
}

/** "2SpG1YUR…": the start of a signature, for a line read from across a table. */
export function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}…`;
}
