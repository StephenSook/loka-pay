import { expect, test } from "@playwright/test";
import { parseProgramLogs, summarizeLogs, summarizeTransaction } from "../lib/logs";
import { PINS } from "../lib/pins";
import { encodeBase58 } from "../lib/base58";
import { EVENT_DISCRIMINATORS, INSTRUCTION_DISCRIMINATORS } from "../lib/vault";
import recorded from "./fixtures/devnet-transactions.json";
import { base64, concat, filled, le32, le64, pubkey } from "./bytes";

// The two real transactions are recorded from devnet (unit/fixtures/devnet-transactions.json).
// The redeem, withdraw and failure logs below are TEST FIXTURES in the shape Anchor and
// the runtime log them; no such transaction exists on devnet yet.

const P = PINS.programId;
const TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

const redeemEvent = base64(
  concat([...EVENT_DISCRIMINATORS.NoteRedeemed], filled(32, 0x44), le64(17), [3], filled(32, 0x55), le64(2_500_000)),
);
const withdrawEvent = base64(
  concat([...EVENT_DISCRIMINATORS.Withdrawn], filled(32, 0x66), pubkey(PINS.wallets.tableDemo), le64(1_000_000), le64(0)),
);

const REDEEM_LOGS = [
  "Program ComputeBudget111111111111111111111111111111 invoke [1]",
  "Program ComputeBudget111111111111111111111111111111 success",
  `Program ${P} invoke [1]`,
  "Program log: Instruction: RedeemNote",
  `Program data: ${redeemEvent}`,
  `Program ${P} consumed 21000 of 200000 compute units`,
  `Program ${P} success`,
];

const SERIAL_USED_LOGS = [
  `Program ${P} invoke [1]`,
  "Program log: Instruction: RedeemNote",
  "Program log: AnchorError thrown in programs/loka_vault/src/instructions/redeem.rs:46. Error Code: SerialUsed. Error Number: 6011. Error Message: This allowance serial was already redeemed.",
  `Program ${P} consumed 9000 of 200000 compute units`,
  `Program ${P} failed: custom program error: 0x177b`,
];

test("the recorded initialize_vault transaction names initialize_vault, not the token program's lines", () => {
  const logs = recorded.initializeVault.meta.logMessages;
  // The associated token program logs "Create" and the token program runs inside our frame.
  expect(logs).toContain("Program log: Create");
  const parsed = parseProgramLogs(logs, P);
  expect(parsed.instructions).toEqual(["initialize_vault"]);
  expect(parsed.error).toBeNull();
  expect(parsed.events).toEqual([]);
  expect(parsed.truncated).toBe(false);
});

test("summarizeTransaction on the recorded initialize transaction", () => {
  const summary = summarizeTransaction(recorded.initializeVault, P);
  expect(summary).toMatchObject({
    signature: "2y4go46y25K6yMnSc4eVZCtbs3nKQzubb6Qr2Byp6piXGuCMWniaiL2aVBsrfMkAxUfJ9odVNcKKpqG3g4EraT4R",
    slot: 509428827,
    blockTime: 1791608579,
    result: "succeeded",
    actions: ["initialize_vault"],
    amounts: [],
    error: null,
  });
});

test("summarizeTransaction on the recorded deploy: the loader deployed this program", () => {
  const summary = summarizeTransaction(recorded.deploy, P);
  expect(summary?.actions).toEqual(["program deployed"]);
  expect(summary?.result).toBe("succeeded");
  expect(summary?.slot).toBe(509428340);
});

test("a loader line naming another program is ignored", () => {
  const parsed = parseProgramLogs(
    [
      "Program BPFLoaderUpgradeab1e11111111111111111111111 invoke [1]",
      `Deployed program ${TOKEN}`,
      "Program BPFLoaderUpgradeab1e11111111111111111111111 success",
    ],
    P,
  );
  expect(parsed.loader).toBeNull();
});

test("redeem_note with its NoteRedeemed event (test fixture logs)", () => {
  const s = summarizeLogs("sig", 5, null, REDEEM_LOGS, P);
  expect(s.actions).toEqual(["redeem_note"]);
  expect(s.amounts).toEqual([{ label: "Note redeemed", units: "2500000" }]);
  expect(s.result).toBe("succeeded");
});

test("withdraw with its Withdrawn event; a token transfer inside our frame is not our instruction", () => {
  const logs = [
    `Program ${P} invoke [1]`,
    "Program log: Instruction: Withdraw",
    `Program ${TOKEN} invoke [2]`,
    "Program log: Instruction: TransferChecked",
    `Program ${TOKEN} success`,
    `Program data: ${withdrawEvent}`,
    `Program ${P} success`,
  ];
  const parsed = parseProgramLogs(logs, P);
  expect(parsed.instructions).toEqual(["withdraw"]);
  expect(parsed.events).toHaveLength(1);
  expect(summarizeLogs("sig", 1, null, logs, P).amounts).toEqual([{ label: "Withdrawn", units: "1000000" }]);
});

test("an event logged by another program is not ours", () => {
  const logs = [`Program ${TOKEN} invoke [1]`, `Program data: ${redeemEvent}`, `Program ${TOKEN} success`];
  expect(parseProgramLogs(logs, P).events).toEqual([]);
});

test("the program's named error from a failed redeem (test fixture logs)", () => {
  const s = summarizeLogs("sig", 9, { InstructionError: [0, { Custom: 6011 }] }, SERIAL_USED_LOGS, P);
  expect(s.result).toBe("failed");
  expect(s.error).toEqual({ name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" });
  expect(s.errText).toBe('{"InstructionError":[0,{"Custom":6011}]}');
  expect(s.actions).toEqual(["redeem_note"]);
});

test("an account-constraint error is parsed too", () => {
  const parsed = parseProgramLogs(
    [
      `Program ${P} invoke [1]`,
      "Program log: Instruction: RedeemNote",
      "Program log: AnchorError caused by account: allowance. Error Code: ConstraintSeeds. Error Number: 2006. Error Message: A seeds constraint was violated.",
      `Program ${P} failed: custom program error: 0x7d6`,
    ],
    P,
  );
  expect(parsed.error).toEqual({ name: "ConstraintSeeds", number: 2006, message: "A seeds constraint was violated" });
});

test("two top-level calls are both listed, and truncation is reported", () => {
  const parsed = parseProgramLogs(
    [
      `Program ${P} invoke [1]`,
      "Program log: Instruction: RegisterMerchant",
      `Program ${P} success`,
      `Program ${P} invoke [1]`,
      "Program log: Instruction: OpenAllowance",
      "Log truncated",
    ],
    P,
  );
  expect(parsed.instructions).toEqual(["register_merchant", "open_allowance"]);
  expect(parsed.truncated).toBe(true);
});

test("open_allowance: the deposit (cap + bond) comes from the instruction data (test fixture transaction)", () => {
  const data = concat(
    [...INSTRUCTION_DISCRIMINATORS.open_allowance],
    le64(42),
    concat([0x02], filled(32, 0x77)),
    le64(5_000_000),
    le64(2_000_000),
    le64(1_760_400_000),
    le64(250_000),
    le32(0),
  );
  const tx = {
    slot: 600,
    blockTime: 1_791_700_000,
    meta: {
      err: null,
      logMessages: [`Program ${P} invoke [1]`, "Program log: Instruction: OpenAllowance", `Program ${P} success`],
    },
    transaction: {
      signatures: ["fixture-signature"],
      message: {
        accountKeys: [PINS.wallets.tableDemo, P],
        instructions: [{ programIdIndex: 1, accounts: [0], data: encodeBase58(data) }],
      },
    },
  };
  const s = summarizeTransaction(tx, P);
  expect(s?.actions).toEqual(["open_allowance"]);
  expect(s?.amounts).toEqual([{ label: "Deposited (cap + bond)", units: "5250000" }]);
  expect(s?.blockTime).toBe(1_791_700_000);
});

// A failed transaction moved nothing. Its instruction data is whatever the sender typed and
// its events were rolled back, so no amount from either may reach /live or /judge.
function openAllowanceTx(err: unknown) {
  const data = concat(
    [...INSTRUCTION_DISCRIMINATORS.open_allowance],
    le64(43),
    concat([0x02], filled(32, 0x78)),
    le64(999_000_000_000),
    le64(1),
    le64(1_760_400_000),
    le64(1),
    le32(0),
  );
  return {
    slot: 601,
    blockTime: 1_791_700_100,
    meta: {
      err,
      logMessages: [
        `Program ${P} invoke [1]`,
        "Program log: Instruction: OpenAllowance",
        `Program ${P} failed: custom program error: 0x1`,
      ],
    },
    transaction: {
      signatures: ["fixture-failed-open"],
      message: {
        accountKeys: [PINS.wallets.tableDemo, P],
        instructions: [{ programIdIndex: 1, accounts: [0], data: encodeBase58(data) }],
      },
    },
  };
}

test("a failed open_allowance shows no deposit, whatever its instruction data says (test fixture transaction)", () => {
  const s = summarizeTransaction(openAllowanceTx({ InstructionError: [0, { Custom: 1 }] }), P);
  expect(s?.result).toBe("failed");
  expect(s?.actions).toEqual(["open_allowance"]);
  expect(s?.amounts).toEqual([]);
  // The same transaction, had it succeeded, would show the amount: the guard is the failure.
  expect(summarizeTransaction(openAllowanceTx(null), P)?.amounts).toEqual([
    { label: "Deposited (cap + bond)", units: "999000000001" },
  ]);
});

test("a failed redeem shows no amount from its rolled-back event (test fixture logs)", () => {
  const logs = [
    `Program ${P} invoke [1]`,
    "Program log: Instruction: RedeemNote",
    `Program data: ${redeemEvent}`,
    `Program ${P} failed: custom program error: 0x177b`,
  ];
  const err = { InstructionError: [0, { Custom: 6011 }] };
  const fromLogs = summarizeLogs("sig", 10, err, logs, P);
  expect(fromLogs.result).toBe("failed");
  expect(fromLogs.amounts).toEqual([]);
  // The event is still parsed (the logs say it was emitted); it is only not shown as money.
  expect(parseProgramLogs(logs, P).events).toHaveLength(1);
  const fromTx = summarizeTransaction(
    {
      slot: 602,
      blockTime: null,
      meta: { err, logMessages: logs },
      transaction: { signatures: ["fixture-failed-redeem"], message: { accountKeys: [P], instructions: [] } },
    },
    P,
  );
  expect(fromTx?.result).toBe("failed");
  expect(fromTx?.amounts).toEqual([]);
});

test("summarizeTransaction refuses an answer of the wrong shape", () => {
  expect(summarizeTransaction(null, P)).toBeNull();
  expect(summarizeTransaction({ slot: 1 }, P)).toBeNull();
});

// Solana allows a transaction's metadata to be null, and an answer may lack its err field.
// Neither says the transaction succeeded: the result is unknown and no amount is shown, even
// when the logs carry an event (TEST FIXTURE transactions).
test.describe("a result the answer does not state is unknown, never Succeeded", () => {
  const tx = (meta: unknown) => ({
    slot: 603,
    blockTime: 1_791_700_200,
    meta,
    transaction: { signatures: ["fixture-no-meta"], message: { accountKeys: [P], instructions: [] } },
  });

  test("null metadata", () => {
    const s = summarizeTransaction(tx(null), P);
    expect(s?.result).toBe("unknown");
    expect(s?.amounts).toEqual([]);
    expect(s?.errText).toBeNull();
  });

  test("metadata with no err field, even with a redeem event in its logs", () => {
    const s = summarizeTransaction(tx({ logMessages: REDEEM_LOGS }), P);
    expect(s?.result).toBe("unknown");
    expect(s?.actions).toEqual(["redeem_note"]);
    expect(s?.amounts).toEqual([]);
    expect(summarizeTransaction(tx({}), P)?.result).toBe("unknown");
  });

  test("failure logs with no err field: the program's error is still named, the result is unknown", () => {
    const s = summarizeTransaction(tx({ logMessages: SERIAL_USED_LOGS }), P);
    expect(s?.result).toBe("unknown");
    expect(s?.error?.name).toBe("SerialUsed");
  });

  test("a notification with no err field, or a malformed one", () => {
    expect(summarizeLogs("sig", 11, undefined, REDEEM_LOGS, P)).toMatchObject({ result: "unknown", amounts: [] });
    expect(summarizeLogs("sig", 11, 42, REDEEM_LOGS, P)).toMatchObject({ result: "unknown", amounts: [] });
  });

  test("an err field that names an error by string is a failure", () => {
    const s = summarizeTransaction(tx({ err: "AccountInUse", logMessages: [] }), P);
    expect(s?.result).toBe("failed");
    expect(s?.errText).toBe('"AccountInUse"');
  });
});
