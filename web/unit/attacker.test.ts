import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { verifyP256 } from "@lokapay/protocol";
import {
  NOTE_FIELDS,
  NOTE_LENGTH,
  U64_MAX,
  changedCount,
  changedRuns,
  describeFields,
  describeNote,
  describeRuns,
  presetAmount,
  readAmount,
  recheck,
  reencodeNote,
  reencodes,
  shortHash,
  withEditedNote,
} from "../lib/attacker";
import type { SerializedDeployment } from "../lib/receipt";
import { TEST_VECTOR } from "../lib/test-vector";

// "Play the attacker" (PLAN.md 3.52). Every expected value is read from
// protocol/vectors/payment-v1.json or computed here with Buffer arithmetic, never taken
// from the module under test, so a wrong offset fails instead of agreeing with itself.

const repoRoot = path.resolve(__dirname, "..", "..");
const vectors = JSON.parse(readFileSync(path.join(repoRoot, "protocol", "vectors", "payment-v1.json"), "utf8"));
const { constants } = vectors;

type VectorNote = { name: string; noteHex: string; wireHex: string; fields: Record<string, string | number> };
const notes = vectors.notes as VectorNote[];
const noteNamed = (name: string): VectorNote => {
  const found = notes.find((n) => n.name === name);
  if (!found) throw new Error(`no vector note named ${name}`);
  return found;
};
const receiptHex = (name: string): string => {
  const found = (vectors.receipts as Array<{ name: string; wireHex: string }>).find((r) => r.name === name);
  if (!found) throw new Error(`no vector receipt named ${name}`);
  return found.wireHex;
};

const bytes = (hex: string) => new Uint8Array(Buffer.from(hex, "hex"));
const note0 = noteNamed("one_dollar_serial_0");
const note2 = noteNamed("two_dollars_serial_255");
const receipt = bytes(receiptHex("note_0_with_confirmation"));
const pendingReceipt = bytes(receiptHex("note_0_without_confirmation"));

const vectorDeployment: SerializedDeployment = {
  clusterId: constants.clusterIds.devnet,
  programIdHex: constants.programIdHex,
  programIdBase58: constants.programIdBase58,
  mintHex: constants.mintHex,
  mintBase58: constants.mintBase58,
  serverPublicKeyHex: vectors.keys.serverEd25519.publicKeyHex,
};
const merchants = [
  { name: "Test merchant A", label: vectors.keys.merchantA.label, keyHashHex: vectors.keys.merchantA.keyHashHex },
  { name: "Test merchant B", label: vectors.keys.merchantB.label, keyHashHex: vectors.keys.merchantB.keyHashHex },
];

/** Positions where two byte strings differ, found the plain way. */
function differingPositions(a: Uint8Array, b: Uint8Array): number[] {
  expect(a.length).toBe(b.length);
  const out: number[] = [];
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) out.push(i);
  return out;
}

/** Every position a list of runs covers. */
function positionsOf(runs: Array<{ first: number; last: number }>): number[] {
  return runs.flatMap((r) => Array.from({ length: r.last - r.first + 1 }, (_, k) => r.first + k));
}

/** Note 0 with a big-endian u64 amount written at offset 121 (PAYMENT-V1 section 4.1). */
function note0WithAmount(units: bigint): Uint8Array {
  const b = Buffer.from(note0.noteHex, "hex");
  b.writeBigUInt64BE(units, 121);
  return new Uint8Array(b);
}

test.describe("the NOTE_V1 layout", () => {
  test("the field ranges are section 4.1's and tile all 141 bytes", () => {
    expect(NOTE_LENGTH).toBe(constants.sizes.NOTE_V1);
    expect(NOTE_FIELDS.map((f) => [f.id, f.start, f.end - f.start])).toEqual([
      ["prefix", 0, 16],
      ["programId", 16, 32],
      ["clusterId", 48, 1],
      ["mint", 49, 32],
      ["allowanceId", 81, 8],
      ["payeeKeyHash", 89, 32],
      ["amount", 121, 8],
      ["currency", 129, 3],
      ["serial", 132, 1],
      ["expiry", 133, 8],
    ]);
    let at = 0;
    for (const f of NOTE_FIELDS) {
      expect(f.start, f.id).toBe(at);
      at = f.end;
    }
    expect(at).toBe(141);
  });

  test("each range holds the value the vectors file names, in every vector note", () => {
    const range = (id: string) => {
      const f = NOTE_FIELDS.find((x) => x.id === id);
      if (!f) throw new Error(id);
      return f;
    };
    for (const n of notes) {
      const b = Buffer.from(n.noteHex, "hex");
      const slice = (id: string) => b.subarray(range(id).start, range(id).end);
      expect(b.length, n.name).toBe(141);
      expect(slice("prefix").toString("ascii"), n.name).toBe(constants.prefixes.note);
      expect(slice("programId").toString("hex"), n.name).toBe(n.fields.programIdHex);
      expect(slice("clusterId")[0], n.name).toBe(n.fields.clusterId);
      expect(slice("mint").toString("hex"), n.name).toBe(constants.mintHex);
      expect(slice("allowanceId").readBigUInt64BE(0).toString(), n.name).toBe(n.fields.allowanceId);
      expect(slice("payeeKeyHash").toString("hex"), n.name).toBe(n.fields.payeeKeyHashHex);
      expect(slice("amount").readBigUInt64BE(0).toString(), n.name).toBe(n.fields.amount);
      expect(slice("currency").toString("ascii"), n.name).toBe(n.fields.currency);
      expect(slice("serial")[0], n.name).toBe(n.fields.serial);
      expect(slice("expiry").readBigInt64BE(0).toString(), n.name).toBe(n.fields.expiry);
    }
  });
});

test.describe("re-encoding", () => {
  test("every vector note decodes and re-encodes to exactly its own bytes", () => {
    expect(notes.length).toBeGreaterThanOrEqual(4);
    for (const n of notes) {
      expect(n.wireHex.slice(0, 282), n.name).toBe(n.noteHex);
      expect(Buffer.from(reencodeNote(bytes(n.noteHex))).toString("hex"), n.name).toBe(n.noteHex);
      expect(reencodes(bytes(n.noteHex)), n.name).toBe(true);
    }
    expect(reencodes(bytes(note0.noteHex).slice(0, 140))).toBe(false);
  });

  test("an amount edit writes the new u64 at 121 and changes only the bytes that differ", () => {
    const cases: Array<[bigint, number[], string]> = [
      // 1,000,000 is 0x0f4240 and 100,000,000 is 0x05f5e100.
      [BigInt(100_000_000), [125, 126, 127, 128], "bytes 125 to 128"],
      [BigInt(1_000_001), [128], "byte 128"],
      [BigInt(1_010_000), [127, 128], "bytes 127 to 128"],
      [U64_MAX, [121, 122, 123, 124, 125, 126, 127, 128], "bytes 121 to 128"],
    ];
    const signed = bytes(note0.noteHex);
    for (const [units, positions, words] of cases) {
      const edited = reencodeNote(signed, { amount: units });
      expect(Buffer.from(edited).toString("hex"), String(units)).toBe(Buffer.from(note0WithAmount(units)).toString("hex"));
      expect(differingPositions(signed, edited), String(units)).toEqual(positions);
      const runs = changedRuns(signed, edited);
      expect(positionsOf(runs), String(units)).toEqual(positions);
      expect(runs.every((r) => r.fields.length === 1 && r.fields[0] === "amount"), String(units)).toBe(true);
      expect(describeRuns(runs), String(units)).toBe(words);
      expect(changedCount(runs), String(units)).toBe(positions.length);
    }
  });

  test("note 0 with note 2's payee and amount is note 2's bytes except the serial", () => {
    const signed = bytes(note0.noteHex);
    const edited = reencodeNote(signed, {
      amount: BigInt(note2.fields.amount),
      payeeKeyHash: bytes(String(note2.fields.payeeKeyHashHex)),
    });
    const expected = Buffer.from(note2.noteHex, "hex");
    expected[132] = Number(note0.fields.serial);
    expect(Buffer.from(edited).toString("hex")).toBe(expected.toString("hex"));

    const plain = differingPositions(signed, edited);
    const runs = changedRuns(signed, edited);
    expect(positionsOf(runs)).toEqual(plain);
    expect(plain.every((p) => p >= 89 && p <= 128)).toBe(true);
    expect(plain.some((p) => p <= 120)).toBe(true);
    expect(plain.some((p) => p >= 121)).toBe(true);
    expect(describeFields(runs)).toBe("merchant key hash and amount");
    for (const r of runs) {
      expect(r.first).toBeLessThanOrEqual(r.last);
      const ids = new Set<string>();
      for (let p = r.first; p <= r.last; p += 1) ids.add(p <= 120 ? "payeeKeyHash" : "amount");
      expect([...r.fields].sort()).toEqual([...ids].sort());
    }
  });

  test("runs join only consecutive positions and name every field they touch", () => {
    const signed = bytes(note0.noteHex);
    const edited = signed.slice();
    for (const p of [88, 89, 92, 140]) edited[p] ^= 0x01;
    const runs = changedRuns(signed, edited);
    expect(runs).toEqual([
      { first: 88, last: 89, fields: ["allowanceId", "payeeKeyHash"] },
      { first: 92, last: 92, fields: ["payeeKeyHash"] },
      { first: 140, last: 140, fields: ["expiry"] },
    ]);
    expect(describeRuns(runs)).toBe("bytes 88 to 89, 92 and 140");
    expect(describeFields(runs)).toBe("allowance id, merchant key hash and expiry");
    expect(changedCount(runs)).toBe(4);
    expect(changedRuns(signed, signed)).toEqual([]);
    expect(describeRuns([])).toBe("no bytes");
    expect(() => changedRuns(signed, signed.slice(0, 140))).toThrow(RangeError);
  });

  test("withEditedNote replaces the first 141 bytes and keeps everything after them", () => {
    const edited = note0WithAmount(BigInt(100_000_000));
    const before = receipt.slice();
    const out = withEditedNote(receipt, edited);
    expect(out.length).toBe(receipt.length);
    expect(Buffer.from(out.subarray(0, 141)).toString("hex")).toBe(Buffer.from(edited).toString("hex"));
    expect(Buffer.from(out.subarray(141)).toString("hex")).toBe(Buffer.from(receipt.subarray(141)).toString("hex"));
    expect(receipt).toEqual(before);
  });
});

test.describe("the re-check", () => {
  test("the signed note passes the same check and an edited one fails on its signature", () => {
    for (const r of [receipt, pendingReceipt]) {
      const signed = r.slice(0, 141);
      expect(recheck(r, signed, null, vectorDeployment)).toEqual({ kind: "matches" });

      const amount = recheck(r, note0WithAmount(BigInt(100_000_000)), null, vectorDeployment);
      expect(amount.kind).toBe("signature_mismatch");
      if (amount.kind !== "signature_mismatch") throw new Error("unreachable");
      expect(describeRuns(amount.runs)).toBe("bytes 125 to 128");

      const payee = recheck(
        r,
        reencodeNote(signed, { payeeKeyHash: bytes(vectors.keys.merchantB.keyHashHex) }),
        null,
        vectorDeployment,
      );
      expect(payee.kind).toBe("signature_mismatch");
      if (payee.kind !== "signature_mismatch") throw new Error("unreachable");
      expect(positionsOf(payee.runs).every((p) => p >= 89 && p <= 120)).toBe(true);
    }
  });

  test("a check that stops before the signature is reported as it is, not as a mismatch", () => {
    const zero = recheck(receipt, note0WithAmount(BigInt(0)), null, vectorDeployment);
    expect(zero.kind).toBe("other");
    if (zero.kind !== "other") throw new Error("unreachable");
    expect(zero.evaluation.kind).toBe("failed");
    if (zero.evaluation.kind !== "failed") throw new Error("unreachable");
    expect(zero.evaluation.code).toBe("amount_zero");
    expect(zero.evaluation.located?.stage).toBe("note");
  });

  test("an edit onto a note the same payer also signed is a mismatch of the kept signature only", () => {
    // equivocation.secondNoteWireHex: note 0 at 0.50 for test merchant B, signed by the same
    // payer key. Its own signature verifies over these bytes; note 0's does not. So the
    // panel's words may say only that the original signature does not match.
    const second = bytes(vectors.equivocation.secondNoteWireHex);
    const secondNote = second.slice(0, 141);
    const edited = reencodeNote(bytes(note0.noteHex), {
      amount: BigInt(500_000),
      payeeKeyHash: bytes(vectors.keys.merchantB.keyHashHex),
    });
    expect(Buffer.from(edited).toString("hex")).toBe(Buffer.from(secondNote).toString("hex"));
    const payerKey = bytes(vectors.keys.payer.publicKeyHex);
    expect(Buffer.from(second.slice(205, 238)).toString("hex")).toBe(vectors.keys.payer.publicKeyHex);
    expect(() => verifyP256(second.slice(141, 205), secondNote, payerKey)).not.toThrow();
    expect(() => verifyP256(bytes(note0.wireHex).slice(141, 205), secondNote, payerKey)).toThrow(/bad_signature/);

    const outcome = recheck(receipt, edited, null, vectorDeployment);
    expect(outcome.kind).toBe("signature_mismatch");
  });
});

test.describe("what the panel shows", () => {
  test("note 0's fields are decoded from its bytes", () => {
    const fields = describeNote(bytes(note0.noteHex), merchants);
    const value = (id: string) => fields.find((f) => f.field.id === id)?.value;
    expect(value("prefix")).toBe(constants.prefixes.note);
    expect(value("programId")).toBe(constants.programIdBase58);
    expect(value("clusterId")).toBe("0 (devnet)");
    expect(value("mint")).toBe(constants.mintBase58);
    expect(value("allowanceId")).toBe(note0.fields.allowanceId);
    const payee = String(note0.fields.payeeKeyHashHex);
    expect(payee).toBe(vectors.keys.merchantA.keyHashHex);
    expect(value("payeeKeyHash")).toBe(`${payee.slice(0, 8)}...${payee.slice(-8)} (Test merchant A)`);
    // 1,000,000 base units at 6 decimals (PAYMENT-V1 section 4.1, "Units").
    expect(note0.fields.amount).toBe("1000000");
    expect(value("amount")).toBe("1.00 sandbox USD (1,000,000 base units)");
    expect(value("currency")).toBe("USD");
    expect(value("serial")).toBe(String(note0.fields.serial));
    // 1893456000 is 21,915 days after 1970-01-01: 60 years, 15 of them leap years.
    expect(note0.fields.expiry).toBe("1893456000");
    expect(value("expiry")).toBe("2030-01-01 00:00:00 UTC (1893456000 unix seconds)");
    for (const f of fields) {
      expect(f.hex.join(""), f.field.id).toBe(note0.noteHex.slice(f.field.start * 2, f.field.end * 2));
    }
  });

  test("a payee that is no test merchant shows only its short hash", () => {
    const other = "ab".repeat(32);
    const edited = reencodeNote(bytes(note0.noteHex), { payeeKeyHash: bytes(other) });
    const payee = describeNote(edited, merchants).find((f) => f.field.id === "payeeKeyHash");
    expect(payee?.value).toBe("abababab...abababab");
    expect(shortHash("0123456789")).toBe("0123456789");
  });

  test("the one-tap amount is 100 times the signed one, or a hundredth when that would overflow", () => {
    expect(presetAmount(BigInt(1_000_000))).toBe(BigInt(100_000_000));
    expect(presetAmount(U64_MAX)).toBe(U64_MAX / BigInt(100));
    expect(presetAmount(BigInt(1))).toBe(BigInt(100));
  });

  test("the amount box reads dollars into base units and names what it refuses", () => {
    // The vectors file's own display and base-unit pairs (PAYMENT-V1 section 4.1, "Units").
    for (const u of vectors.units as Array<{ display: string; baseUnits: string }>) {
      expect(readAmount(u.display), u.display).toEqual({ units: BigInt(u.baseUnits) });
    }
    expect(readAmount(" $1,000.5 ")).toEqual({ units: BigInt(1_000_500_000) });
    expect(readAmount("100")).toEqual({ units: BigInt(100_000_000) });
    expect(readAmount("18446744073709.551615")).toEqual({ units: U64_MAX });
    expect(readAmount("18446744073709.551616")).toEqual({ problem: "too_large" });
    expect(readAmount("0")).toEqual({ problem: "zero" });
    expect(readAmount("0.000000")).toEqual({ problem: "zero" });
    for (const bad of ["", "1.2345678", "-1", "1e3", "abc", "1.", ".5"]) {
      expect(readAmount(bad), JSON.stringify(bad)).toEqual({ problem: "format" });
    }
  });

  test("the page's test merchants are the vectors file's keys, with their labels", () => {
    expect(TEST_VECTOR.testMerchants).toEqual(merchants);
  });
});
