// The loka_vault program's errors (programs/loka_vault/src/error.rs, as programs/idl/loka_vault.json
// lists them), so a page can name a refusal from a transaction's error code alone: devnet's
// `err` {"InstructionError":[1,{"Custom":6011}]} is SerialUsed (6011). unit/program-errors.test.ts
// checks this table against the IDL entry by entry. Pure functions, no network.
//
// A code is only named from this table for a failed instruction of a transaction that touches
// this program; when the program's own log line names the error (lib/logs.ts), that line wins.

import type { ProgramError } from "./logs";

const ERRORS: ReadonlyArray<readonly [number, string, string]> = [
  [6000, "InvalidAuthority", "Only this program's current upgrade authority may initialize configuration"],
  [6001, "BadSysvar", "The instructions sysvar must be canonical"],
  [6002, "BadPrecompile", "Expected the canonical adjacent single-signature P-256 precompile"],
  [6003, "WrongMessage", "The verified message differs from the canonical instruction message"],
  [6004, "PayerMismatch", "The verified public key differs from the registered key"],
  [6005, "InvalidNote", "Invalid signed prefix, currency or amount"],
  [6006, "WrongProgram", "The signed program id does not match this program"],
  [6007, "WrongCluster", "The signed cluster does not match the deployment"],
  [6008, "WrongMint", "The signed mint does not match the deployment"],
  [6009, "InvalidAllowance", "The allowance does not match the signed allowance id"],
  [6010, "InvalidMerchant", "The merchant does not match the signed payee"],
  [6011, "SerialUsed", "This allowance serial was already redeemed"],
  [6012, "CapExceeded", "The cumulative redeemed amount would exceed the funded cap"],
  [6013, "Expired", "Expired allowance or note, or note expiry exceeds allowance expiry"],
  [6014, "EarmarkDenied", "The allowance does not permit this merchant"],
  [6015, "Overflow", "Integer arithmetic overflow"],
  [6016, "WithdrawalReplay", "The withdrawal counter is not the current merchant counter"],
  [6017, "InsufficientBalance", "The withdrawal exceeds the merchant's credited balance"],
  [6018, "BadDestination", "The destination is not the signed wallet"],
  [6019, "InvalidPayerKey", "Expected a compressed P-256 key prefix"],
  [6020, "InvalidEarmarks", "Earmarks must be sorted, unique and at most sixteen"],
  [6021, "InvalidLimits", "The cap must be positive and offline limit at most the cap"],
  [6022, "InvalidMintDecimals", "The configured token mint must have six decimals"],
];

/** Every program error by its number. */
export const PROGRAM_ERRORS: ReadonlyMap<number, ProgramError> = new Map(
  ERRORS.map(([number, name, message]) => [number, { name, number, message }]),
);

/**
 * What a transaction's `err` field says, read without its logs:
 * - "program": a custom code this program defines, at instruction `instruction`;
 * - "custom": a custom code this program does not define (another program's, or unknown);
 * - "instruction": a runtime error at an instruction, such as "InvalidAccountData";
 * - "transaction": an error for the whole transaction, such as "BlockhashNotFound";
 * - "unreadable": not a shape devnet sends.
 */
export type TxErrorReading =
  | { kind: "program"; instruction: number; error: ProgramError }
  | { kind: "custom"; instruction: number; code: number }
  | { kind: "instruction"; instruction: number; reason: string }
  | { kind: "transaction"; reason: string }
  | { kind: "unreadable" };

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** Reads `err` as getSignaturesForAddress, getTransaction or a logs notification sends it. */
export function readTxError(err: unknown): TxErrorReading {
  if (typeof err === "string" && err.length > 0) return { kind: "transaction", reason: err };
  if (typeof err !== "object" || err === null || Array.isArray(err)) return { kind: "unreadable" };
  const entries = Object.entries(err as Record<string, unknown>);
  if (entries.length !== 1) return { kind: "unreadable" };
  const [key, value] = entries[0];
  if (key !== "InstructionError") return { kind: "transaction", reason: key };
  if (!Array.isArray(value) || value.length !== 2 || !isIndex(value[0])) return { kind: "unreadable" };
  const [instruction, inner] = value;
  if (typeof inner === "string" && inner.length > 0) return { kind: "instruction", instruction, reason: inner };
  if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
    const innerEntries = Object.entries(inner as Record<string, unknown>);
    if (innerEntries.length === 1) {
      const [innerKey, innerValue] = innerEntries[0];
      if (innerKey === "Custom" && isIndex(innerValue)) {
        const known = PROGRAM_ERRORS.get(innerValue);
        return known ? { kind: "program", instruction, error: known } : { kind: "custom", instruction, code: innerValue };
      }
      return { kind: "instruction", instruction, reason: innerKey };
    }
  }
  return { kind: "unreadable" };
}

/** The program error an `err` field names, or null when it names none this program defines. */
export function programErrorOf(err: unknown): ProgramError | null {
  const reading = readTxError(err);
  return reading.kind === "program" ? reading.error : null;
}

/** Plain words for an `err` field, never the raw JSON: "SerialUsed (6011): This allowance serial was already redeemed." */
export function describeTxError(err: unknown): string {
  const reading = readTxError(err);
  switch (reading.kind) {
    case "program":
      return `${reading.error.name} (${reading.error.number}): ${reading.error.message}.`;
    case "custom":
      return `Error code ${reading.code} at instruction ${reading.instruction}, which this program does not define.`;
    case "instruction":
      return `${reading.reason} at instruction ${reading.instruction}.`;
    case "transaction":
      return `${reading.reason} (an error for the whole transaction).`;
    case "unreadable":
      return "Failed, with an error this page cannot read.";
  }
}
