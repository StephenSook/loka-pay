import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PROGRAM_ERRORS, describeTxError, programErrorOf, readTxError } from "../lib/program-errors";

// The program's error table (lib/program-errors.ts) against programs/idl/loka_vault.json, and
// reading devnet's `err` field without logs. The err values below are the shapes devnet sends;
// {"InstructionError":[1,{"Custom":6011}]} is the recorded refusal of the iPhone cheat 3XtQtnHR.

const idl = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "programs", "idl", "loka_vault.json"), "utf8"));

test("the table is the IDL's errors, entry for entry", () => {
  const fromIdl = (idl.errors as Array<{ code: number; name: string; msg: string }>).map((e) => [e.code, e.name, e.msg]);
  const fromTable = [...PROGRAM_ERRORS.values()].map((e) => [e.number, e.name, e.message]);
  expect(fromTable).toEqual(fromIdl);
  expect(fromTable.length).toBeGreaterThan(20);
});

test("a custom code the program defines is named, with the failing instruction", () => {
  const err = { InstructionError: [1, { Custom: 6011 }] };
  expect(readTxError(err)).toEqual({
    kind: "program",
    instruction: 1,
    error: { name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" },
  });
  expect(programErrorOf(err)?.name).toBe("SerialUsed");
  expect(describeTxError(err)).toBe("SerialUsed (6011): This allowance serial was already redeemed.");
  expect(describeTxError({ InstructionError: [1, { Custom: 6012 }] })).toBe(
    "CapExceeded (6012): The cumulative redeemed amount would exceed the funded cap.",
  );
});

test("other errors are said in words, never as raw JSON", () => {
  const cases: Array<[unknown, string]> = [
    [{ InstructionError: [0, { Custom: 2 }] }, "Error code 2 at instruction 0, which this program does not define."],
    [{ InstructionError: [0, "InvalidAccountData"] }, "InvalidAccountData at instruction 0."],
    [{ InstructionError: [2, { BorshIoError: "x" }] }, "BorshIoError at instruction 2."],
    ["BlockhashNotFound", "BlockhashNotFound (an error for the whole transaction)."],
    [{ InsufficientFundsForRent: { account_index: 0 } }, "InsufficientFundsForRent (an error for the whole transaction)."],
    [null, "Failed, with an error this page cannot read."],
    [{ InstructionError: ["1", { Custom: 6011 }] }, "Failed, with an error this page cannot read."],
    [{ InstructionError: [1] }, "Failed, with an error this page cannot read."],
    [[1, 2], "Failed, with an error this page cannot read."],
  ];
  for (const [err, words] of cases) {
    expect(describeTxError(err), JSON.stringify(err)).toBe(words);
    expect(describeTxError(err)).not.toMatch(/[{}[\]"]/);
    expect(programErrorOf(err)).toBeNull();
  }
});
