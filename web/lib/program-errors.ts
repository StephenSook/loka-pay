// The loka_vault program's errors (programs/loka_vault/src/error.rs, as programs/idl/loka_vault.json
// lists them), so a page can name a refusal from a transaction's error code: devnet's `err`
// {"InstructionError":[1,{"Custom":6011}]} is SerialUsed (6011) when instruction 1 is this
// program's. unit/program-errors.test.ts checks this table against the IDL entry by entry. Pure
// functions, no network.
//
// A Custom code is this program's only when the instruction that failed is. InstructionError's
// index counts the transaction's top-level instructions, and the P-256 precompile, the compute
// budget program and any other program in the same transaction report Custom codes too, so
// another program's 6011 is not SerialUsed. server/src/settle/transaction.ts draws the same line
// (preflightProgramError: only redeem_note's codes are ours). A code is therefore named only when
// the instruction at the failing index is addressed to this program, read from the transaction
// itself (ownInstructionsOf). Until the transaction is read, the code is said as a number at its
// instruction and not named. When the program's own log line names the error (lib/logs.ts), that
// line wins.

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
 * Which of a transaction's top-level instructions are addressed to this program, as far as the
 * page has read:
 * - "read": from its getTransaction answer, the indexes of those instructions (ownInstructionsOf);
 * - "reading": its details are still being read (the signature list and a logs notification
 *   carry no instructions);
 * - "unread": its details could not be read.
 */
export type OwnInstructions = { kind: "read"; indexes: readonly number[] } | { kind: "reading" } | { kind: "unread" };

/** Who raised a failure: this program's own instruction, anything else, or not known yet. */
export type Owner = "ours" | "other" | "unknown";

/**
 * What a transaction's `err` field says, given which instructions are this program's:
 * - "program": a custom code this program defines, at one of its own instructions;
 * - "custom": any other custom code: one this program does not define at its own instruction
 *   (owner "ours"), any code at another program's instruction ("other"), or a code at an
 *   instruction not read yet ("unknown");
 * - "instruction": a runtime error at an instruction, such as "InvalidAccountData";
 * - "transaction": an error for the whole transaction, such as "BlockhashNotFound";
 * - "unreadable": not a shape devnet sends.
 */
export type TxErrorReading =
  | { kind: "program"; instruction: number; error: ProgramError }
  | { kind: "custom"; instruction: number; code: number; owner: Owner }
  | { kind: "instruction"; instruction: number; reason: string; owner: Owner }
  | { kind: "transaction"; reason: string }
  | { kind: "unreadable" };

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

interface RawAnswer {
  meta?: { loadedAddresses?: { writable?: unknown; readonly?: unknown } | null } | null;
  transaction?: { message?: { accountKeys?: unknown; instructions?: unknown } };
}

/**
 * The top-level instructions a getTransaction answer (encoding "json") addresses to `programId`,
 * by index: an instruction's program is its programIdIndex into the account keys (static, then
 * the loaded writable and read-only addresses, as lib/logs.ts reads them). "unread" for an answer
 * that does not list its account keys and instructions.
 */
export function ownInstructionsOf(raw: unknown, programId: string): OwnInstructions {
  if (typeof raw !== "object" || raw === null) return { kind: "unread" };
  const { meta, transaction } = raw as RawAnswer;
  const message = transaction?.message;
  if (!isStringList(message?.accountKeys) || !Array.isArray(message.instructions)) return { kind: "unread" };
  const loaded = typeof meta === "object" && meta !== null ? meta.loadedAddresses : null;
  const keys = [
    ...message.accountKeys,
    ...(isStringList(loaded?.writable) ? loaded.writable : []),
    ...(isStringList(loaded?.readonly) ? loaded.readonly : []),
  ];
  const indexes: number[] = [];
  message.instructions.forEach((ix: unknown, index: number) => {
    const programIdIndex = typeof ix === "object" && ix !== null ? (ix as { programIdIndex?: unknown }).programIdIndex : undefined;
    // An instruction whose program cannot be read is not shown to be this program's.
    if (isIndex(programIdIndex) && keys[programIdIndex] === programId) indexes.push(index);
  });
  return { kind: "read", indexes };
}

function ownerOf(instruction: number, own: OwnInstructions): Owner {
  if (own.kind !== "read") return "unknown";
  return own.indexes.includes(instruction) ? "ours" : "other";
}

/** Reads `err` as getSignaturesForAddress, getTransaction or a logs notification sends it. */
export function readTxError(err: unknown, own: OwnInstructions): TxErrorReading {
  if (typeof err === "string" && err.length > 0) return { kind: "transaction", reason: err };
  if (typeof err !== "object" || err === null || Array.isArray(err)) return { kind: "unreadable" };
  const entries = Object.entries(err as Record<string, unknown>);
  if (entries.length !== 1) return { kind: "unreadable" };
  const [key, value] = entries[0];
  if (key !== "InstructionError") return { kind: "transaction", reason: key };
  if (!Array.isArray(value) || value.length !== 2 || !isIndex(value[0])) return { kind: "unreadable" };
  const [instruction, inner] = value;
  const owner = ownerOf(instruction, own);
  if (typeof inner === "string" && inner.length > 0) return { kind: "instruction", instruction, reason: inner, owner };
  if (typeof inner === "object" && inner !== null && !Array.isArray(inner)) {
    const innerEntries = Object.entries(inner as Record<string, unknown>);
    if (innerEntries.length === 1) {
      const [innerKey, innerValue] = innerEntries[0];
      if (innerKey === "Custom" && isIndex(innerValue)) {
        const known = PROGRAM_ERRORS.get(innerValue);
        return known && owner === "ours" ? { kind: "program", instruction, error: known } : { kind: "custom", instruction, code: innerValue, owner };
      }
      return { kind: "instruction", instruction, reason: innerKey, owner };
    }
  }
  return { kind: "unreadable" };
}

/**
 * Whether this program's own instruction raised the failure: "ours" when the failing top-level
 * instruction is addressed to this program, "other" when it is another program's or the error is
 * for the whole transaction, "unknown" when the instructions are not read or `err` cannot be read.
 */
export function failureOwner(err: unknown, own: OwnInstructions): Owner {
  const reading = readTxError(err, own);
  switch (reading.kind) {
    case "program":
      return "ours";
    case "custom":
    case "instruction":
      return reading.owner;
    case "transaction":
      return "other";
    case "unreadable":
      return "unknown";
  }
}

/** The program error an `err` field names at one of this program's instructions, or null. */
export function programErrorOf(err: unknown, own: OwnInstructions): ProgramError | null {
  const reading = readTxError(err, own);
  return reading.kind === "program" ? reading.error : null;
}

/** Plain words for an `err` field, never the raw JSON: "SerialUsed (6011): This allowance serial was already redeemed." */
export function describeTxError(err: unknown, own: OwnInstructions): string {
  const reading = readTxError(err, own);
  switch (reading.kind) {
    case "program":
      return `${reading.error.name} (${reading.error.number}): ${reading.error.message}.`;
    case "custom":
      if (reading.owner === "ours") return `Error code ${reading.code} at instruction ${reading.instruction}, which this program does not define.`;
      if (reading.owner === "other") {
        return `Error code ${reading.code} at instruction ${reading.instruction}, which another program ran, so it is not this program's error.`;
      }
      return own.kind === "reading"
        ? `Failed with error code ${reading.code} at instruction ${reading.instruction} (reading details).`
        : `Failed with error code ${reading.code} at instruction ${reading.instruction} (details not read, so not named).`;
    case "instruction":
      return reading.owner === "other"
        ? `${reading.reason} at instruction ${reading.instruction}, which another program ran.`
        : `${reading.reason} at instruction ${reading.instruction}.`;
    case "transaction":
      return `${reading.reason} (an error for the whole transaction).`;
    case "unreadable":
      return "Failed, with an error this page cannot read.";
  }
}
