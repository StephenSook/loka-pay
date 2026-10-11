import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { failureOf, failureWords, isRefusal, lastPayment, shortSignature } from "../lib/live-desk";
import { PINS } from "../lib/pins";
import { detailOutcome, readInto, rowsFromSignatures, type Row } from "../lib/program-feed";
import { rowLabels } from "../lib/row-labels";
import recorded from "./fixtures/devnet-live-desk.json";

// /live at the judge desk (PLAN.md 3.84): lib/live-desk.ts and lib/row-labels.ts against the
// program's latest 20 transactions as devnet answered them (unit/fixtures/devnet-live-desk.json,
// its _about says how). Hand-made rows are labelled TEST FIXTURE.

const P = PINS.programId;
const facts = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8")).facts;
const txs = recorded.getTransaction as Record<string, { result: unknown }>;

const SETTLED_IPHONE = "2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17";
const REFUSED_IPHONE = "3XtQtnHRKC3QvhBGye8gTMWimPg3iPXuBskf3LMsQEhJPdzeGiqEEjrmjFLqXFTJMQ9JFAitWoCbuEGFSLKjZc9n";
const REFUSED_RUN2 = "3uBwo59QKFcXXkGJZRPZw8X8hk6x2Yr2wr69cFDuu6c45wd38N76jBoshsEgbc2SKzAHWssUmfpSf9ACgnnUT6HK";

/** The rows /live shows from the recorded signature list, before any details are read. */
const listed = (): Row[] => rowsFromSignatures(recorded.getSignaturesForAddress.result);

/** A getTransaction answer read into a row, as /live does (lib/program-feed.ts detailOutcome, readInto). */
function withAnswer(row: Row, answer: unknown): Row {
  const outcome = detailOutcome({ ok: true, result: answer }, P);
  if (outcome.kind !== "read") throw new Error(`unreadable answer for ${row.signature}`);
  return readInto(row, outcome);
}

/** The listed rows with the recorded getTransaction answer read into each. */
const read = (): Row[] => listed().map((row) => withAnswer(row, txs[row.signature].result));

type RawTx = {
  slot: number;
  blockTime: number;
  meta: Record<string, unknown> & { err: unknown; logMessages: string[] };
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: Array<Record<string, unknown>> } };
};

/**
 * TEST FIXTURE, the attack: a transaction whose instruction 0 is another program failing with
 * Custom 6011, and whose instruction 1 is a loka_vault redeem_note (the recorded cheat's bytes)
 * that never ran. Built from the recorded refusal 3XtQtnHR, newer than every recorded row.
 */
function crafted(): { row: Row; answer: RawTx } {
  const base = txs[REFUSED_IPHONE].result as RawTx;
  const OTHER = "Another1111111111111111111111111111111111111";
  const signature = "Crafted1111111111111111111111111111111111111111111111111111111111111111111111111111111";
  const err = { InstructionError: [0, { Custom: 6011 }] };
  const message = base.transaction.message;
  const answer: RawTx = {
    ...base,
    slot: base.slot + 100_000,
    meta: { ...base.meta, err, logMessages: [`Program ${OTHER} invoke [1]`, `Program ${OTHER} failed: custom program error: 0x177b`] },
    transaction: {
      ...base.transaction,
      signatures: [signature],
      message: { ...message, accountKeys: [...message.accountKeys, OTHER], instructions: [{ ...message.instructions[0], programIdIndex: message.accountKeys.length }, message.instructions[1]] },
    },
  };
  const [row] = rowsFromSignatures([{ signature, slot: answer.slot, err, blockTime: answer.blockTime }]);
  return { row, answer };
}

test.describe("what a failed row says before its details arrive", () => {
  test("every failed row in the recorded list says its error code and instruction, never a name it cannot know yet, never raw JSON", () => {
    const failed = listed().filter((r) => r.result === "failed");
    expect(failed.map((r) => r.signature)).toContain(REFUSED_IPHONE);
    expect(failed.length).toBeGreaterThanOrEqual(3);
    for (const row of failed) {
      expect(row.details).toBe("reading");
      expect(row.errText).toBe(JSON.stringify({ InstructionError: [1, { Custom: 6011 }] }));
      const failure = failureOf(row);
      expect(failure).toEqual({ kind: "words", owner: "unknown", words: "Failed with error code 6011 at instruction 1 (reading details)." });
      expect(isRefusal(failure!)).toBe(false);
      expect(failureWords(failure!)).not.toMatch(/SerialUsed|InstructionError|[{}[\]"]/);
    }
  });

  test("a row whose details were given up on says so, and still does not name the code", () => {
    // TEST FIXTURE rows: the recorded cheat, details given up on, then unavailable.
    const row = listed().find((r) => r.signature === REFUSED_IPHONE)!;
    const words = "Failed with error code 6011 at instruction 1 (details not read, so not named).";
    expect(failureOf({ ...row, details: "unread" })).toEqual({ kind: "words", owner: "unknown", words });
    expect(failureOf({ ...row, details: "unavailable" })).toEqual({ kind: "words", owner: "unknown", words });
  });
});

test.describe("what a failed row says once its details arrive", () => {
  test("the program's own log line names it", () => {
    const row = read().find((r) => r.signature === REFUSED_IPHONE)!;
    expect(row.ownInstructions).toEqual([1]);
    const failure = failureOf(row)!;
    expect(failure).toMatchObject({ kind: "program", fromLogs: true, error: { name: "SerialUsed", number: 6011 } });
    expect(isRefusal(failure)).toBe(true);
    expect(failureWords(failure)).toBe("SerialUsed (6011): This allowance serial was already redeemed.");
  });

  test("without the log line, its code is named because the failing instruction 1 is loka_vault's own", () => {
    // TEST FIXTURE: the recorded cheat's answer with its AnchorError line removed.
    const raw = txs[REFUSED_IPHONE].result as RawTx;
    const cut = { ...raw, meta: { ...raw.meta, logMessages: raw.meta.logMessages.filter((l) => !l.includes("AnchorError")) } };
    const row = withAnswer(listed().find((r) => r.signature === REFUSED_IPHONE)!, cut);
    expect(row.error).toBeNull();
    expect(failureOf(row)).toEqual({
      kind: "program",
      fromLogs: false,
      error: { name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" },
    });
  });

  test("another program's 6011 at instruction 0 is never SerialUsed and never a refusal", () => {
    const { row, answer } = crafted();
    // Before its details: the code and instruction only.
    expect(failureOf(row)).toEqual({ kind: "words", owner: "unknown", words: "Failed with error code 6011 at instruction 0 (reading details)." });
    // After: instruction 0 is another program's, so the code is not this program's error.
    const readRow = withAnswer(row, answer);
    expect(readRow.actions).toEqual(["redeem_note"]);
    expect(readRow.ownInstructions).toEqual([1]);
    const failure = failureOf(readRow)!;
    expect(failure).toEqual({
      kind: "words",
      owner: "other",
      words: "Error code 6011 at instruction 0, run by another program; not named as this program's error.",
    });
    expect(isRefusal(failure)).toBe(false);
  });

  test("an error the program does not define, or unreadable text, is said in words", () => {
    // TEST FIXTURE rows: the recorded cheat read, with other errors in its errText.
    const base = read().find((r) => r.signature === REFUSED_IPHONE)!;
    const words = (errText: string | null) => failureOf({ ...base, result: "failed", error: null, errText });
    expect(words(JSON.stringify({ InstructionError: [1, "InvalidAccountData"] }))).toEqual({ kind: "words", owner: "ours", words: "InvalidAccountData at instruction 1." });
    expect(words(JSON.stringify({ InstructionError: [0, "InvalidInstructionData"] }))).toEqual({
      kind: "words",
      owner: "other",
      words: "InvalidInstructionData at instruction 0, which another program ran.",
    });
    expect(words("not json")).toEqual({ kind: "words", owner: "unknown", words: "Failed, with an error this page cannot read." });
    expect(words(null)).toEqual({ kind: "words", owner: "unknown", words: "Failed, with an error this page cannot read." });
    expect(failureOf({ ...base, result: "succeeded", error: null, errText: null })).toBeNull();
  });
});

test.describe("the kiosk's last payment", () => {
  test("is the newest redeem_note read: the recorded 5:09 PM refusal, SerialUsed (6011)", () => {
    const last = lastPayment(read());
    expect(last.kind).toBe("refused");
    if (last.kind !== "refused") return;
    expect(last.row.signature).toBe(REFUSED_RUN2);
    expect(last.row.blockTime).toBe(1791666579);
    expect(failureWords(last.failure)).toBe("SerialUsed (6011): This allowance serial was already redeemed.");
    expect(last.newerReading).toBe(0);
  });

  test("passes over a failed redeem_note the program did not refuse: another program's 6011 is never Refused", () => {
    // TEST FIXTURE: the crafted transaction (another program's 6011 at instruction 0), newest.
    const { row, answer } = crafted();
    const last = lastPayment([withAnswer(row, answer), ...read()]);
    expect(last).toMatchObject({ kind: "refused", newerReading: 0 });
    expect(last.kind === "refused" && last.row.signature).toBe(REFUSED_RUN2);
    // With only that transaction, there is no payment at all.
    expect(lastPayment([withAnswer(row, answer)])).toEqual({ kind: "none", reading: 0 });
  });

  test("a failed redeem_note whose failing instruction is not known yet counts as still being read, not as Refused", () => {
    // TEST FIXTURE: the recorded 5:09 PM cheat as a logs notification without its AnchorError line
    // (actions from its logs, no instructions read yet).
    const raw = txs[REFUSED_RUN2].result as RawTx;
    const listedRow = listed().find((r) => r.signature === REFUSED_RUN2)!;
    const unread: Row = { ...listedRow, actions: ["redeem_note"], error: null, details: "reading" };
    expect(raw.meta.err).toEqual({ InstructionError: [1, { Custom: 6011 }] });
    const last = lastPayment([unread, ...read().filter((r) => r.signature !== REFUSED_RUN2)]);
    expect(last).toMatchObject({ kind: "paid", newerReading: 1 });
  });

  test("so does one whose details were given up on or unavailable: the older payment is never shown as last without the newer row counted", () => {
    // TEST FIXTURE: the recorded 5:09 PM cheat as a logs notification without its AnchorError line
    // (actions from its logs, error null, err InstructionError [1, Custom 6011]), then getTransaction
    // given up on ("unread") or answering an unreadable shape ("unavailable").
    const listedRow = listed().find((r) => r.signature === REFUSED_RUN2)!;
    const older = read().filter((r) => r.signature !== REFUSED_RUN2);
    for (const details of ["unread", "unavailable"] as const) {
      const row: Row = { ...listedRow, actions: ["redeem_note"], error: null, details };
      expect(failureOf(row), details).toMatchObject({ kind: "words", owner: "unknown" });
      const last = lastPayment([row, ...older]);
      expect(last, details).toMatchObject({ kind: "paid", newerReading: 1 });
      expect(last.kind === "paid" && last.row.signature, details).not.toBe(REFUSED_RUN2);
      // Alone, it is not a payment found, and it is counted as not read.
      expect(lastPayment([row]), details).toEqual({ kind: "none", reading: 1 });
    }
  });

  test("a settled payment carries its NoteRedeemed amount", () => {
    const rows = read().filter((r) => r.signature !== REFUSED_RUN2);
    const last = lastPayment(rows);
    expect(last).toMatchObject({ kind: "paid", amountUnits: "250000" });
  });

  test("before details nothing can be told apart: no payment yet, with the rows still being read counted", () => {
    expect(lastPayment(listed())).toEqual({ kind: "none", reading: 20 });
    expect(lastPayment([])).toEqual({ kind: "none", reading: 0 });
  });

  test("rows above the payment that are still being read are counted", () => {
    const rows = read();
    // TEST FIXTURE: the newest two rows not read yet.
    rows[0] = { ...rows[0], actions: [], details: "reading" };
    rows[1] = { ...rows[1], actions: [], details: "reading" };
    const last = lastPayment(rows);
    expect(last).toMatchObject({ kind: "refused", newerReading: 2 });
  });

  test("the short signature is its first eight characters", () => {
    expect(shortSignature(SETTLED_IPHONE)).toBe("2SpG1YUR…");
  });
});

test.describe("labels for the rows FACTS records", () => {
  const KEYS = {
    proof_pair_iphone_settled_tx: "iPhone payment",
    proof_pair_iphone_refused_tx: "iPhone cheat",
    proof_pair_iphone_run2_settled_tx: "iPhone payment",
    proof_pair_iphone_run2_refused_tx: "iPhone cheat",
    proof_pair_settled_tx: "Test key",
    proof_pair_refused_tx: "Test key",
  } as const;

  test("both iPhone runs and the test-key pair, by the signatures in docs/FACTS.json, each with its FACTS caveat", () => {
    const labels = rowLabels();
    expect(Object.keys(labels).sort()).toEqual(Object.keys(KEYS).map((k) => facts[k].value).sort());
    for (const [key, chip] of Object.entries(KEYS)) {
      const label = labels[facts[key].value];
      expect(label.chip, key).toBe(chip);
      expect(facts[key].caveat, key).toContain(label.detail.replace(/\.$/, ""));
    }
  });

  test("both iPhone runs are in the recorded latest 20, and only rows FACTS records are labelled", () => {
    const labels = rowLabels();
    const signatures = listed().map((r) => r.signature);
    for (const signature of [SETTLED_IPHONE, REFUSED_IPHONE, REFUSED_RUN2]) expect(signatures).toContain(signature);
    expect(labels[REFUSED_RUN2]).toEqual({ chip: "iPhone cheat", detail: facts.proof_pair_iphone_run2_refused_tx.caveat });
    // The other 16 recorded rows (opens, registrations, the 3:44 PM refusal 4E4yWq7Q) have no FACTS entry.
    const unlabelled = signatures.filter((s) => !(s in labels));
    expect(unlabelled.length).toBe(signatures.length - 4);
  });
});
