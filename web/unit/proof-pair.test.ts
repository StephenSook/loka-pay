import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { FIRST_REDEEM_TX_SIGNATURE, REFUSED_CHEAT_TX_SIGNATURE } from "../lib/facts";
import { PROOF_PAIR, PROOF_PAIR_LABEL, recordedTx } from "../lib/proof-pair";

// The proof pair (lib/proof-pair.ts) reads its two signatures from docs/FACTS.json. The file
// is read again here, not through the app, so a wrong value fails instead of passing by
// construction.

const factsFile = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8"));
const SETTLED = factsFile.facts.proof_pair_settled_tx;
const REFUSED = factsFile.facts.proof_pair_refused_tx;

test("both signatures are the FACTS values, with their explorer links and block times", () => {
  expect(PROOF_PAIR.settled.signature).toBe(SETTLED.value);
  expect(PROOF_PAIR.refused.signature).toBe(REFUSED.value);
  expect(PROOF_PAIR.settled.explorer).toBe(`https://explorer.solana.com/tx/${SETTLED.value}?cluster=devnet`);
  expect(PROOF_PAIR.refused.explorer).toBe(`https://explorer.solana.com/tx/${REFUSED.value}?cluster=devnet`);
  expect(PROOF_PAIR.settled.blockTimeMs).toBe(Date.parse(SETTLED.as_of));
  expect(PROOF_PAIR.refused.blockTimeMs).toBe(Date.parse(REFUSED.as_of));
  expect(PROOF_PAIR.settled.signature).not.toBe(PROOF_PAIR.refused.signature);
});

test("FACTS and lib/facts.ts name the same two transactions, so /proof, /verify and the pair agree", () => {
  expect(SETTLED.value).toBe(FIRST_REDEEM_TX_SIGNATURE);
  expect(REFUSED.value).toBe(REFUSED_CHEAT_TX_SIGNATURE);
});

test("each FACTS entry says how it was signed and where it was checked", () => {
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
