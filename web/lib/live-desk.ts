// /live at the judge desk (PLAN.md 3.84): what a failed row says, before and after its details
// arrive, and the kiosk's "Last payment" line. Pure functions over lib/program-feed.ts rows,
// unit-tested in unit/live-desk.test.ts. The labels for recorded rows are lib/row-labels.ts
// (server side, since they read docs/FACTS.json).
//
// A failed row says its error code in words as soon as the signature list arrives, so it is
// never blank or raw JSON while its details are queued under devnet's rate limit. It is named
// (SerialUsed) only once its details show that the failing instruction is the program's own
// (lib/program-errors.ts), because another program in the same transaction can return 6011 too;
// until then it reads "Failed with error code 6011 at instruction 1 (reading details)". The
// program's own log line, once read, wins. A failure is a refusal only when the program raised
// it: a transaction that failed in another program's instruction, or for the whole transaction,
// is never labelled Refused, whatever its instruction data says.

import type { ProgramError } from "./logs";
import type { Row } from "./program-feed";
import { describeTxError, failureOwner, programErrorOf, type OwnInstructions, type Owner } from "./program-errors";

/** devnet's `err` field back from a row's errText (it is JSON.stringify of that field), or undefined. */
function errOf(row: Pick<Row, "errText">): unknown {
  if (row.errText === null) return undefined;
  try {
    return JSON.parse(row.errText);
  } catch {
    return undefined;
  }
}

/** Which of the row's top-level instructions are the program's, as far as its details have been read. */
export function ownInstructionsOfRow(row: Pick<Row, "details" | "ownInstructions">): OwnInstructions {
  if (row.details === "read" && row.ownInstructions) return { kind: "read", indexes: row.ownInstructions };
  return row.details === "reading" ? { kind: "reading" } : { kind: "unread" };
}

export type Failure =
  /** The program's own error: from its log line, or from its error code at one of its own instructions. */
  | { kind: "program"; error: ProgramError; fromLogs: boolean }
  /** Any other failure, in words (lib/program-errors.ts describeTxError); `owner` says who raised it, as far as is known. */
  | { kind: "words"; words: string; owner: Owner };

/** Why a failed row failed, for the page to show. Null for a row that did not fail. */
export function failureOf(row: Pick<Row, "result" | "error" | "errText" | "details" | "ownInstructions">): Failure | null {
  if (row.result !== "failed") return null;
  if (row.error) return { kind: "program", error: row.error, fromLogs: true };
  const err = errOf(row);
  const own = ownInstructionsOfRow(row);
  const error = programErrorOf(err, own);
  if (error) return { kind: "program", error, fromLogs: false };
  return { kind: "words", words: describeTxError(err, own), owner: failureOwner(err, own) };
}

/** Whether the program refused it: its own log line names the error, or its own instruction failed. */
export function isRefusal(failure: Failure): boolean {
  return failure.kind === "program" || failure.owner === "ours";
}

/** One line for a failure: "SerialUsed (6011): This allowance serial was already redeemed." */
export function failureWords(failure: Failure): string {
  return failure.kind === "program" ? `${failure.error.name} (${failure.error.number}): ${failure.error.message}.` : failure.words;
}

export type LastPayment =
  | { kind: "paid"; row: Row; amountUnits: string | null; newerReading: number; newerUnread: number }
  | { kind: "refused"; row: Row; failure: Failure; newerReading: number; newerUnread: number }
  | { kind: "unknown"; row: Row; newerReading: number; newerUnread: number }
  /** No redeem_note among the rows read so far; `reading` and `unread` rows may be one. */
  | { kind: "none"; reading: number; unread: number };

/**
 * The newest payment among the rows (newest first, as the feed keeps them): the first row whose
 * instructions include redeem_note and that settled, that the program refused, or whose result is
 * unknown. A failed one the program did not refuse (another program's instruction failed, or the
 * whole transaction) is not a payment and is passed over. Some rows above it cannot be told
 * apart: a row whose details are not read (a row from the signature list has no actions until
 * they are), and a failed redeem_note whose failing instruction is not known. Each is counted,
 * above the payment in `newerReading` or `newerUnread` and with no payment found in `reading` or
 * `unread`: "reading" while its details are still being read, "unread" once they were given up
 * on, came back unavailable, or were read with an error that cannot be read. So the kiosk never
 * shows an older payment as the last one without saying how many newer rows it could not place,
 * and whether it is still reading them.
 */
export function lastPayment(rows: readonly Row[]): LastPayment {
  let reading = 0;
  let unread = 0;
  const count = (row: Row) => {
    if (row.details === "reading") reading += 1;
    else unread += 1;
  };
  for (const row of rows) {
    if (!row.actions.includes("redeem_note")) {
      if (row.details !== "read") count(row);
      continue;
    }
    if (row.result === "succeeded") {
      const redeemed = row.amounts.find((a) => a.label === "Note redeemed");
      return { kind: "paid", row, amountUnits: redeemed ? redeemed.units : null, newerReading: reading, newerUnread: unread };
    }
    const failure = failureOf(row);
    if (failure) {
      if (isRefusal(failure)) return { kind: "refused", row, failure, newerReading: reading, newerUnread: unread };
      if (failure.kind === "words" && failure.owner === "unknown") count(row);
      continue;
    }
    return { kind: "unknown", row, newerReading: reading, newerUnread: unread };
  }
  return { kind: "none", reading, unread };
}

/** "2SpG1YUR…": the start of a signature, for a line read from across a table. */
export function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}…`;
}
