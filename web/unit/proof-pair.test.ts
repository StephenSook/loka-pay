import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  FIRST_REDEEM_TX_SIGNATURE,
  IPHONE_REFUSED_NOTE_ID,
  IPHONE_REFUSED_TX_SIGNATURE,
  IPHONE_SETTLED_NOTE_ID,
  IPHONE_SETTLED_TX_SIGNATURE,
  REFUSED_CHEAT_TX_SIGNATURE,
} from "../lib/facts";
import {
  IPHONE_PAIR,
  IPHONE_REFUSED_LABEL,
  IPHONE_SETTLED_LABEL,
  PROOF_PAIR,
  PROOF_PAIR_LABEL,
  recordedNoteId,
  recordedTx,
} from "../lib/proof-pair";
import { formatEt } from "../lib/time";

// The proof pairs (lib/proof-pair.ts) read their signatures and note ids from docs/FACTS.json.
// The file is read again here, not through the app, so a wrong value fails instead of passing
// by construction.

const factsFile = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8"));
const SETTLED = factsFile.facts.proof_pair_settled_tx;
const REFUSED = factsFile.facts.proof_pair_refused_tx;
const IPHONE_SETTLED = factsFile.facts.proof_pair_iphone_settled_tx;
const IPHONE_REFUSED = factsFile.facts.proof_pair_iphone_refused_tx;
const IPHONE_SETTLED_NOTE = factsFile.facts.proof_pair_iphone_settled_note_id;
const IPHONE_REFUSED_NOTE = factsFile.facts.proof_pair_iphone_refused_note_id;
const explorer = (signature: string) => `https://explorer.solana.com/tx/${signature}?cluster=devnet`;

test("the iPhone pair: FACTS signatures, explorer links, block times and note ids, settled and refused not swapped", () => {
  expect(IPHONE_PAIR.settled.signature).toBe(IPHONE_SETTLED.value);
  expect(IPHONE_PAIR.refused.signature).toBe(IPHONE_REFUSED.value);
  expect(IPHONE_PAIR.settled.explorer).toBe(explorer(IPHONE_SETTLED.value));
  expect(IPHONE_PAIR.refused.explorer).toBe(explorer(IPHONE_REFUSED.value));
  expect(IPHONE_PAIR.settled.blockTimeMs).toBe(Date.parse(IPHONE_SETTLED.as_of));
  expect(IPHONE_PAIR.refused.blockTimeMs).toBe(Date.parse(IPHONE_REFUSED.as_of));
  expect(IPHONE_PAIR.settled.noteId).toBe(IPHONE_SETTLED_NOTE.value);
  expect(IPHONE_PAIR.refused.noteId).toBe(IPHONE_REFUSED_NOTE.value);
  // The settled link is the redeem that succeeded, the refused link the 6011 refusal: the
  // hardcoded lib/facts.ts values decide which is which, so a swap in FACTS or in the pair fails.
  expect(IPHONE_PAIR.settled.explorer).toBe(explorer(IPHONE_SETTLED_TX_SIGNATURE));
  expect(IPHONE_PAIR.refused.explorer).toBe(explorer(IPHONE_REFUSED_TX_SIGNATURE));
  expect(IPHONE_PAIR.settled.signature).not.toBe(IPHONE_PAIR.refused.signature);
  // The settled one came first, and each block time is the time its label states.
  expect(IPHONE_PAIR.settled.blockTimeMs).toBeLessThan(IPHONE_PAIR.refused.blockTimeMs);
  expect(formatEt(IPHONE_PAIR.settled.blockTimeMs)).toBe("Sat, Oct 10, 4:23:21 PM ET");
  expect(formatEt(IPHONE_PAIR.refused.blockTimeMs)).toBe("Sat, Oct 10, 4:31:16 PM ET");
});

test("FACTS and lib/facts.ts name the same iPhone transactions and note ids", () => {
  expect(IPHONE_SETTLED.value).toBe(IPHONE_SETTLED_TX_SIGNATURE);
  expect(IPHONE_REFUSED.value).toBe(IPHONE_REFUSED_TX_SIGNATURE);
  expect(IPHONE_SETTLED_NOTE.value).toBe(IPHONE_SETTLED_NOTE_ID);
  expect(IPHONE_REFUSED_NOTE.value).toBe(IPHONE_REFUSED_NOTE_ID);
});

test("each iPhone FACTS entry is measured, says how it was signed and names the getTransaction check", () => {
  for (const entry of [IPHONE_SETTLED, IPHONE_REFUSED, IPHONE_SETTLED_NOTE, IPHONE_REFUSED_NOTE]) {
    expect(entry.kind).toBe("measured");
    expect(entry.status).toBe("measured");
    expect(entry.source).toContain("getTransaction");
  }
  expect(IPHONE_SETTLED.caveat).toContain(IPHONE_SETTLED_LABEL);
  expect(IPHONE_REFUSED.caveat).toContain(IPHONE_REFUSED_LABEL);
  expect(IPHONE_SETTLED.source).toContain("RedeemNote");
  expect(IPHONE_SETTLED.source).toContain("meta.err null");
  expect(IPHONE_REFUSED.source).toContain("Custom 6011");
  expect(IPHONE_REFUSED.source).toContain("SerialUsed");
  // The same note ids the transactions' sources say the precompile message hashes to.
  expect(IPHONE_SETTLED.source).toContain("proof_pair_iphone_settled_note_id");
  expect(IPHONE_REFUSED.source).toContain("proof_pair_iphone_refused_note_id");
  expect(IPHONE_SETTLED_LABEL).toBe("Signed on an iPhone (Secure Enclave key), paid offline by camera QR, Sat Oct 10 4:23 PM ET");
  expect(IPHONE_REFUSED_LABEL).toBe(
    "Same allowance and serial signed again on that iPhone, refused by Solana: SerialUsed (6011), Sat Oct 10 4:31 PM ET",
  );
  for (const label of [IPHONE_SETTLED_LABEL, IPHONE_REFUSED_LABEL]) expect(label).not.toMatch(/\blive\b/i);
});

test("the earlier test-key pair: FACTS signatures, explorer links and block times", () => {
  expect(PROOF_PAIR.settled.signature).toBe(SETTLED.value);
  expect(PROOF_PAIR.refused.signature).toBe(REFUSED.value);
  expect(PROOF_PAIR.settled.explorer).toBe(explorer(SETTLED.value));
  expect(PROOF_PAIR.refused.explorer).toBe(explorer(REFUSED.value));
  expect(PROOF_PAIR.settled.blockTimeMs).toBe(Date.parse(SETTLED.as_of));
  expect(PROOF_PAIR.refused.blockTimeMs).toBe(Date.parse(REFUSED.as_of));
  expect(PROOF_PAIR.settled.signature).not.toBe(PROOF_PAIR.refused.signature);
  // A different pair from the iPhone one.
  expect([PROOF_PAIR.settled.signature, PROOF_PAIR.refused.signature]).not.toContain(IPHONE_PAIR.settled.signature);
  expect([PROOF_PAIR.settled.signature, PROOF_PAIR.refused.signature]).not.toContain(IPHONE_PAIR.refused.signature);
});

test("FACTS and lib/facts.ts name the same test-key transactions, so /proof, /verify and the pair agree", () => {
  expect(SETTLED.value).toBe(FIRST_REDEEM_TX_SIGNATURE);
  expect(REFUSED.value).toBe(REFUSED_CHEAT_TX_SIGNATURE);
});

test("each test-key FACTS entry says how it was signed and where it was checked", () => {
  for (const entry of [SETTLED, REFUSED]) {
    expect(entry.status).toBe("measured");
    expect(entry.caveat).toContain("Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET");
    expect(entry.source).toContain("getTransaction");
  }
  expect(REFUSED.source).toContain("6011");
  expect(PROOF_PAIR_LABEL).toBe("Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.");
  expect(PROOF_PAIR_LABEL).not.toMatch(/\blive\b/i);
});

test("an entry that is missing, not measured, not a 64-byte signature or undated fails the build", () => {
  const good = { value: SETTLED.value, status: "measured", as_of: SETTLED.as_of };
  expect(recordedTx("k", good).signature).toBe(SETTLED.value);
  expect(() => recordedTx("k", undefined)).toThrow("docs/FACTS.json facts.k is missing");
  expect(() => recordedTx("k", { ...good, status: "pending" })).toThrow('has status "pending", not "measured"');
  expect(() => recordedTx("k", { ...good, value: null })).toThrow("has no signature value");
  expect(() => recordedTx("k", { ...good, value: "0OIl" })).toThrow("is not base58");
  // A 32-byte account address is not a transaction signature.
  expect(() => recordedTx("k", { ...good, value: "HSgcxix3LGjdCQ7FGexBosdvzmHz7ZfHdkpyXYYteBGG" })).toThrow("decodes to 32 bytes");
  expect(() => recordedTx("k", { ...good, as_of: null })).toThrow("has no as_of time");
});

test("a note id that is missing, not measured or not 32 bytes of lowercase hex fails the build", () => {
  const good = { value: IPHONE_SETTLED_NOTE_ID, status: "measured" };
  expect(recordedNoteId("n", good)).toBe(IPHONE_SETTLED_NOTE_ID);
  expect(() => recordedNoteId("n", undefined)).toThrow("docs/FACTS.json facts.n is missing");
  expect(() => recordedNoteId("n", { ...good, status: "pending" })).toThrow('has status "pending", not "measured"');
  expect(() => recordedNoteId("n", { ...good, value: null })).toThrow("is not a 32-byte hex note id");
  expect(() => recordedNoteId("n", { ...good, value: IPHONE_SETTLED_NOTE_ID.slice(2) })).toThrow("is not a 32-byte hex note id");
  expect(() => recordedNoteId("n", { ...good, value: IPHONE_SETTLED_NOTE_ID.toUpperCase() })).toThrow("is not a 32-byte hex note id");
});
