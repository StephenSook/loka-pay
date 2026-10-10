import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { refusalOf, refusalWords } from "../lib/live-desk";
import { summarizeTransaction } from "../lib/logs";
import { PINS } from "../lib/pins";
import { rowsFromSignatures, type Row } from "../lib/program-feed";
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

/** The same rows with the recorded getTransaction answer merged into each, as /live does. */
function read(): Row[] {
  return listed().map((row) => {
    const summary = summarizeTransaction(txs[row.signature].result, P);
    if (!summary) throw new Error(`unreadable recorded answer for ${row.signature}`);
    return { ...row, ...summary, details: "read" };
  });
}

test.describe("naming a refusal before its details arrive", () => {
  test("every failed row in the recorded list is named from its error code, never raw JSON", () => {
    const failed = listed().filter((r) => r.result === "failed");
    expect(failed.map((r) => r.signature)).toContain(REFUSED_IPHONE);
    expect(failed.length).toBeGreaterThanOrEqual(3);
    for (const row of failed) {
      expect(row.details).toBe("reading");
      expect(row.errText).toContain("InstructionError");
      const refusal = refusalOf(row);
      expect(refusal).toEqual({
        kind: "program",
        fromLogs: false,
        error: { name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" },
      });
      expect(refusalWords(refusal!)).toBe("SerialUsed (6011): This allowance serial was already redeemed.");
      expect(refusalWords(refusal!)).not.toMatch(/InstructionError|[{}[\]"]/);
    }
  });

  test("once details arrive, the program's own log line names it", () => {
    const row = read().find((r) => r.signature === REFUSED_IPHONE)!;
    expect(refusalOf(row)).toMatchObject({ kind: "program", fromLogs: true, error: { name: "SerialUsed", number: 6011 } });
  });

  test("an error the program does not define, or unreadable text, is said in words", () => {
    // TEST FIXTURE rows.
    const base = listed()[0];
    const words = (errText: string | null) => refusalOf({ ...base, result: "failed", error: null, errText });
    expect(words(JSON.stringify({ InstructionError: [0, "InvalidInstructionData"] }))).toEqual({ kind: "words", words: "InvalidInstructionData at instruction 0." });
    expect(words("not json")).toEqual({ kind: "words", words: "Failed, with an error this page cannot read." });
    expect(words(null)).toEqual({ kind: "words", words: "Failed, with an error this page cannot read." });
    expect(refusalOf({ ...base, result: "succeeded", error: null, errText: null })).toBeNull();
  });
});

test.describe("labels for the rows FACTS records", () => {
  test("the iPhone pair and the test-key pair, by the signatures in docs/FACTS.json", () => {
    const labels = rowLabels();
    expect(Object.keys(labels).sort()).toEqual(
      [facts.proof_pair_iphone_settled_tx, facts.proof_pair_iphone_refused_tx, facts.proof_pair_settled_tx, facts.proof_pair_refused_tx]
        .map((f) => f.value)
        .sort(),
    );
    expect(labels[facts.proof_pair_iphone_settled_tx.value].chip).toBe("iPhone payment");
    expect(labels[facts.proof_pair_iphone_refused_tx.value].chip).toBe("iPhone cheat");
    expect(labels[facts.proof_pair_settled_tx.value].chip).toBe("Test key");
    expect(labels[facts.proof_pair_refused_tx.value].chip).toBe("Test key");
    for (const key of ["proof_pair_iphone_settled_tx", "proof_pair_iphone_refused_tx", "proof_pair_settled_tx", "proof_pair_refused_tx"]) {
      expect(facts[key].caveat, key).toContain(labels[facts[key].value].detail.replace(/\.$/, ""));
    }
  });

  test("the iPhone pair is in the recorded latest 20; the 5:05 PM pair carries no label (no FACTS entry)", () => {
    const labels = rowLabels();
    const signatures = listed().map((r) => r.signature);
    expect(signatures).toContain(SETTLED_IPHONE);
    expect(signatures).toContain(REFUSED_IPHONE);
    expect(labels[REFUSED_RUN2]).toBeUndefined();
  });
});
