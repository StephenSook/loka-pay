import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PINS } from "../lib/pins";
import {
  PROGRAM_ERRORS,
  describeTxError,
  failureOwner,
  ownInstructionsOf,
  programErrorOf,
  readTxError,
  type OwnInstructions,
} from "../lib/program-errors";
import recorded from "./fixtures/devnet-transactions.json";

// The program's error table (lib/program-errors.ts) against programs/idl/loka_vault.json, and
// reading devnet's `err` field without logs. The err values below are the shapes devnet sends.
// The recorded refusedRedeem (unit/fixtures/devnet-transactions.json) failed with
// {"InstructionError":[2,{"Custom":6011}]}: its instruction 0 is the compute budget program,
// 1 the P-256 precompile and 2 loka_vault's redeem_note. A code is named only at an instruction
// addressed to the program: another program's 6011 is not SerialUsed.

const idl = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "programs", "idl", "loka_vault.json"), "utf8"));
const P = PINS.programId;
const refused = recorded.refusedRedeem as unknown as {
  meta: Record<string, unknown>;
  transaction: { message: { accountKeys: string[]; instructions: Array<Record<string, unknown>> } };
};

/** Instruction 2 is the program's, as in the recorded refusal. */
const OURS_AT_2: OwnInstructions = { kind: "read", indexes: [2] };
const READING: OwnInstructions = { kind: "reading" };
const UNREAD: OwnInstructions = { kind: "unread" };

test("the table is the IDL's errors, entry for entry", () => {
  const fromIdl = (idl.errors as Array<{ code: number; name: string; msg: string }>).map((e) => [e.code, e.name, e.msg]);
  const fromTable = [...PROGRAM_ERRORS.values()].map((e) => [e.number, e.name, e.message]);
  expect(fromTable).toEqual(fromIdl);
  expect(fromTable.length).toBeGreaterThan(20);
});

test.describe("which instructions are the program's", () => {
  test("in the recorded refusal, only instruction 2 (redeem_note); 0 is the compute budget program and 1 the precompile", () => {
    const { accountKeys, instructions } = refused.transaction.message;
    expect(instructions.map((ix) => accountKeys[ix.programIdIndex as number])).toEqual([
      "ComputeBudget111111111111111111111111111111",
      "Secp256r1SigVerify1111111111111111111111111",
      P,
    ]);
    expect(refused.meta.err).toEqual({ InstructionError: [2, { Custom: 6011 }] });
    expect(ownInstructionsOf(refused, P)).toEqual({ kind: "read", indexes: [2] });
    expect(ownInstructionsOf(refused, PINS.mint)).toEqual({ kind: "read", indexes: [] });
  });

  test("a program id among the loaded addresses counts; an unreadable programIdIndex does not", () => {
    // TEST FIXTURES built from the recorded refusal.
    const message = refused.transaction.message;
    const [ix0, ix1, ix2] = message.instructions;
    const loaded = {
      ...refused,
      meta: { ...refused.meta, loadedAddresses: { writable: [], readonly: [P] } },
      transaction: { ...refused.transaction, message: { ...message, instructions: [ix0, ix1, { ...ix2, programIdIndex: message.accountKeys.length }] } },
    };
    expect(ownInstructionsOf(loaded, P)).toEqual({ kind: "read", indexes: [2] });
    const broken = { ...refused, transaction: { ...refused.transaction, message: { ...message, instructions: [ix0, ix1, { ...ix2, programIdIndex: "5" }] } } };
    expect(ownInstructionsOf(broken, P)).toEqual({ kind: "read", indexes: [] });
  });

  test("an answer that lists no account keys or instructions is unread", () => {
    expect(ownInstructionsOf(null, P)).toEqual({ kind: "unread" });
    expect(ownInstructionsOf({ slot: 1 }, P)).toEqual({ kind: "unread" });
    expect(ownInstructionsOf({ transaction: { message: { accountKeys: [P], instructions: {} } } }, P)).toEqual({ kind: "unread" });
  });
});

test.describe("naming an error code", () => {
  test("a code the program defines, at the program's own instruction, is named", () => {
    const err = refused.meta.err;
    const own = ownInstructionsOf(refused, P);
    expect(readTxError(err, own)).toEqual({
      kind: "program",
      instruction: 2,
      error: { name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" },
    });
    expect(programErrorOf(err, own)?.name).toBe("SerialUsed");
    expect(failureOwner(err, own)).toBe("ours");
    expect(describeTxError(err, own)).toBe("SerialUsed (6011): This allowance serial was already redeemed.");
    expect(describeTxError({ InstructionError: [2, { Custom: 6012 }] }, OURS_AT_2)).toBe(
      "CapExceeded (6012): The cumulative redeemed amount would exceed the funded cap.",
    );
  });

  test("the same code at another program's instruction is not named: another program's 6011 is not SerialUsed", () => {
    const err = { InstructionError: [0, { Custom: 6011 }] };
    expect(readTxError(err, OURS_AT_2)).toEqual({ kind: "custom", instruction: 0, code: 6011, owner: "other" });
    expect(programErrorOf(err, OURS_AT_2)).toBeNull();
    expect(failureOwner(err, OURS_AT_2)).toBe("other");
    expect(describeTxError(err, OURS_AT_2)).toBe("Error code 6011 at instruction 0, which another program ran, so it is not this program's error.");
    // A transaction with no instruction for the program at all.
    expect(programErrorOf({ InstructionError: [2, { Custom: 6011 }] }, { kind: "read", indexes: [] })).toBeNull();
  });

  test("before the instructions are read, a code is said as a number at its instruction, never named", () => {
    const err = { InstructionError: [2, { Custom: 6011 }] };
    expect(readTxError(err, READING)).toEqual({ kind: "custom", instruction: 2, code: 6011, owner: "unknown" });
    expect(programErrorOf(err, READING)).toBeNull();
    expect(failureOwner(err, READING)).toBe("unknown");
    expect(describeTxError(err, READING)).toBe("Failed with error code 6011 at instruction 2 (reading details).");
    expect(describeTxError(err, UNREAD)).toBe("Failed with error code 6011 at instruction 2 (details not read, so not named).");
    expect(describeTxError(err, READING)).not.toContain("SerialUsed");
  });

  test("a code the program does not define, at its own instruction, says so", () => {
    expect(describeTxError({ InstructionError: [2, { Custom: 3012 }] }, OURS_AT_2)).toBe("Error code 3012 at instruction 2, which this program does not define.");
    expect(failureOwner({ InstructionError: [2, { Custom: 3012 }] }, OURS_AT_2)).toBe("ours");
  });
});

test("other errors are said in words, never as raw JSON, and are never a program error", () => {
  const cases: Array<[unknown, OwnInstructions, string, string]> = [
    [{ InstructionError: [2, "InvalidAccountData"] }, OURS_AT_2, "InvalidAccountData at instruction 2.", "ours"],
    [{ InstructionError: [1, "InvalidInstructionData"] }, OURS_AT_2, "InvalidInstructionData at instruction 1, which another program ran.", "other"],
    [{ InstructionError: [0, "InvalidAccountData"] }, READING, "InvalidAccountData at instruction 0.", "unknown"],
    [{ InstructionError: [3, { BorshIoError: "x" }] }, OURS_AT_2, "BorshIoError at instruction 3, which another program ran.", "other"],
    ["BlockhashNotFound", OURS_AT_2, "BlockhashNotFound (an error for the whole transaction).", "other"],
    [{ InsufficientFundsForRent: { account_index: 0 } }, READING, "InsufficientFundsForRent (an error for the whole transaction).", "other"],
    [null, OURS_AT_2, "Failed, with an error this page cannot read.", "unknown"],
    [{ InstructionError: ["2", { Custom: 6011 }] }, OURS_AT_2, "Failed, with an error this page cannot read.", "unknown"],
    [{ InstructionError: [2] }, OURS_AT_2, "Failed, with an error this page cannot read.", "unknown"],
    [[1, 2], OURS_AT_2, "Failed, with an error this page cannot read.", "unknown"],
  ];
  for (const [err, own, words, owner] of cases) {
    expect(describeTxError(err, own), JSON.stringify(err)).toBe(words);
    expect(describeTxError(err, own)).not.toMatch(/[{}[\]"]/);
    expect(programErrorOf(err, own)).toBeNull();
    expect(failureOwner(err, own), JSON.stringify(err)).toBe(owner);
  }
});
