// "Play the attacker" on /verify (PLAN.md 3.52, the part that runs in the browser). The
// visitor edits a verified note's amount or payee; this module re-encodes the 141 note
// bytes with the protocol library, names the byte positions that changed, and hands the
// edited receipt to evaluateBytes, the same check that verified the original. Nothing here
// makes a request or stores anything.

import { SIZES, decodeNote, displayAmount, encodeNote, equalBytes, parseAmount, toHex } from "@lokapay/protocol";
import { encodeBase58 } from "./base58";
import { evaluateBytes, formatUnixUtc, type Evaluation, type SerializedDeployment } from "./receipt";
import type { TestMerchant } from "./test-vector";

export const NOTE_LENGTH = SIZES.NOTE_V1; // 141

export const U64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

// ---------- the NOTE_V1 layout (PAYMENT-V1 section 4.1) ----------

export type NoteFieldId =
  | "prefix"
  | "programId"
  | "clusterId"
  | "mint"
  | "allowanceId"
  | "payeeKeyHash"
  | "amount"
  | "currency"
  | "serial"
  | "expiry";

export interface NoteField {
  id: NoteFieldId;
  label: string;
  /** First byte, counted from 0 as in the protocol's table. */
  start: number;
  /** One past the last byte. */
  end: number;
}

/** Section 4.1, in byte order. A unit test checks that the ranges tile all 141 bytes. */
export const NOTE_FIELDS: readonly NoteField[] = [
  { id: "prefix", label: "Prefix", start: 0, end: 16 },
  { id: "programId", label: "Program id", start: 16, end: 48 },
  { id: "clusterId", label: "Cluster id", start: 48, end: 49 },
  { id: "mint", label: "Mint", start: 49, end: 81 },
  { id: "allowanceId", label: "Allowance id", start: 81, end: 89 },
  { id: "payeeKeyHash", label: "Merchant key hash", start: 89, end: 121 },
  { id: "amount", label: "Amount", start: 121, end: 129 },
  { id: "currency", label: "Currency", start: 129, end: 132 },
  { id: "serial", label: "Serial", start: 132, end: 133 },
  { id: "expiry", label: "Expiry", start: 133, end: 141 },
];

export function fieldAt(position: number): NoteField {
  const field = NOTE_FIELDS.find((f) => position >= f.start && position < f.end);
  if (!field) throw new RangeError(`byte ${position} is outside the ${NOTE_LENGTH} note bytes`);
  return field;
}

/** "byte 128" or "bytes 121 to 128" (inclusive, counted from 0). */
export function rangeWords(first: number, last: number): string {
  return first === last ? `byte ${first}` : `bytes ${first} to ${last}`;
}

// ---------- which bytes changed ----------

/** A run of consecutive changed byte positions, inclusive, and the fields it touches. */
export interface ChangedRun {
  first: number;
  last: number;
  fields: NoteFieldId[];
}

/** Every run of consecutive positions where the two notes differ, in byte order. */
export function changedRuns(signed: Uint8Array, edited: Uint8Array): ChangedRun[] {
  if (signed.length !== NOTE_LENGTH || edited.length !== NOTE_LENGTH) {
    throw new RangeError(`both notes must be ${NOTE_LENGTH} bytes`);
  }
  const runs: ChangedRun[] = [];
  let open: { first: number; last: number } | null = null;
  for (let i = 0; i <= NOTE_LENGTH; i += 1) {
    const differs = i < NOTE_LENGTH && signed[i] !== edited[i];
    if (differs) {
      if (open) open.last = i;
      else open = { first: i, last: i };
    } else if (open) {
      const fields: NoteFieldId[] = [];
      for (let p = open.first; p <= open.last; p += 1) {
        const id = fieldAt(p).id;
        if (!fields.includes(id)) fields.push(id);
      }
      runs.push({ first: open.first, last: open.last, fields });
      open = null;
    }
  }
  return runs;
}

export function changedCount(runs: ChangedRun[]): number {
  return runs.reduce((n, r) => n + (r.last - r.first + 1), 0);
}

/** "byte 128", "bytes 125 to 128", or "bytes 89 to 95, 97 to 120 and 125 to 128". */
export function describeRuns(runs: ChangedRun[]): string {
  if (runs.length === 0) return "no bytes";
  if (runs.length === 1) return rangeWords(runs[0].first, runs[0].last);
  const parts = runs.map((r) => (r.first === r.last ? `${r.first}` : `${r.first} to ${r.last}`));
  return `bytes ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The labels of every field the runs touch, in byte order, joined for a sentence. */
export function describeFields(runs: ChangedRun[]): string {
  const ids = NOTE_FIELDS.filter((f) => runs.some((r) => r.fields.includes(f.id))).map((f) => f.label.toLowerCase());
  if (ids.length <= 1) return ids.join("");
  return `${ids.slice(0, -1).join(", ")} and ${ids[ids.length - 1]}`;
}

// ---------- re-encoding an edited note ----------

export interface NoteEdits {
  amount?: bigint;
  payeeKeyHash?: Uint8Array;
}

/**
 * Decodes the signed note and encodes it again with the protocol library, changing only
 * the edited fields. With no edits the result is the original bytes (checked by
 * `reencodes` before the panel offers any edit, and by the unit tests on every vector note).
 */
export function reencodeNote(signed: Uint8Array, edits: NoteEdits = {}): Uint8Array {
  const note = decodeNote(signed);
  return encodeNote(
    { programId: note.programId, clusterId: note.clusterId, mint: note.mint },
    {
      allowanceId: note.allowanceId,
      payeeKeyHash: edits.payeeKeyHash ?? note.payeeKeyHash,
      amount: edits.amount ?? note.amount,
      currency: note.currency,
      serial: note.serial,
      expiry: note.expiry,
    },
  );
}

/** True when decoding and encoding again gives back exactly these bytes. */
export function reencodes(signed: Uint8Array): boolean {
  try {
    return equalBytes(reencodeNote(signed), signed);
  } catch {
    return false;
  }
}

/** The receipt with its first 141 bytes replaced. Signature, public key, ack and confirmation are kept. */
export function withEditedNote(receipt: Uint8Array, editedNote: Uint8Array): Uint8Array {
  if (editedNote.length !== NOTE_LENGTH) throw new RangeError(`the note must be ${NOTE_LENGTH} bytes`);
  if (receipt.length < NOTE_LENGTH) throw new RangeError("the receipt is shorter than a note");
  const out = receipt.slice();
  out.set(editedNote, 0);
  return out;
}

// ---------- the re-check ----------

export type Outcome =
  /** The bytes are the signed ones and the check passed. */
  | { kind: "matches" }
  /** The note signature check failed with bad_signature: the case the panel is built for. */
  | { kind: "signature_mismatch"; runs: ChangedRun[] }
  /** Any other result, shown as it is (for example a check that stops before the signature). */
  | { kind: "other"; runs: ChangedRun[]; evaluation: Evaluation };

export function recheck(
  receipt: Uint8Array,
  editedNote: Uint8Array,
  pinned: SerializedDeployment | null,
  testVector: SerializedDeployment,
): Outcome {
  const signed = receipt.slice(0, NOTE_LENGTH);
  const runs = changedRuns(signed, editedNote);
  const evaluation = evaluateBytes(withEditedNote(receipt, editedNote), pinned, testVector);
  if (runs.length === 0 && evaluation.kind === "verified") return { kind: "matches" };
  if (
    runs.length > 0 &&
    evaluation.kind === "failed" &&
    evaluation.code === "bad_signature" &&
    evaluation.located?.stage === "note"
  ) {
    return { kind: "signature_mismatch", runs };
  }
  return { kind: "other", runs, evaluation };
}

// ---------- what each field says ----------

/** "3f895a02...98ca8092": the first and last 8 hex characters. */
export function shortHash(hex: string): string {
  return hex.length <= 19 ? hex : `${hex.slice(0, 8)}...${hex.slice(-8)}`;
}

/** The test merchant whose key hash this is, if any. */
export function merchantNamed(keyHashHex: string, merchants: readonly TestMerchant[]): TestMerchant | null {
  return merchants.find((m) => m.keyHashHex === keyHashHex) ?? null;
}

export function amountWords(units: bigint): string {
  return `${displayAmount(units)} sandbox USD (${units.toLocaleString("en-US")} base units)`;
}

export function payeeWords(keyHashHex: string, merchants: readonly TestMerchant[]): string {
  const merchant = merchantNamed(keyHashHex, merchants);
  return merchant ? `${shortHash(keyHashHex)} (${merchant.name})` : shortHash(keyHashHex);
}

const CLUSTERS: Record<number, string> = { 0: "devnet", 1: "mainnet" };

export interface FieldView {
  field: NoteField;
  /** The value in plain words, decoded from this field's bytes. */
  value: string;
  /** One two-character hex string per byte. */
  hex: string[];
}

/** Every field of a note, decoded from its 141 bytes, in byte order. */
export function describeNote(noteBytes: Uint8Array, merchants: readonly TestMerchant[]): FieldView[] {
  const note = decodeNote(noteBytes);
  const words: Record<NoteFieldId, string> = {
    prefix: String.fromCharCode(...noteBytes.slice(0, 16)),
    programId: encodeBase58(note.programId),
    clusterId: `${note.clusterId} (${CLUSTERS[note.clusterId] ?? "unknown cluster"})`,
    mint: encodeBase58(note.mint),
    allowanceId: note.allowanceId.toString(),
    payeeKeyHash: payeeWords(toHex(note.payeeKeyHash), merchants),
    amount: amountWords(note.amount),
    currency: note.currency,
    serial: String(note.serial),
    expiry: `${formatUnixUtc(note.expiry) ?? "outside the range a date can show"} (${note.expiry} unix seconds)`,
  };
  return NOTE_FIELDS.map((field) => ({
    field,
    value: words[field.id],
    hex: Array.from(noteBytes.slice(field.start, field.end), (b) => b.toString(16).padStart(2, "0")),
  }));
}

/** The amount the panel's one-tap button offers: 100 times the signed amount when it fits a u64. */
export function presetAmount(signed: bigint): bigint | null {
  const hundred = BigInt(100);
  const preset = signed * hundred <= U64_MAX ? signed * hundred : signed / hundred;
  return preset > BigInt(0) && preset !== signed ? preset : null;
}

export type AmountProblem = "format" | "zero" | "too_large";

/**
 * The panel's amount box, in sandbox USD: "100", "100.00", "$1,000.5". Up to 6 decimals,
 * the mint's precision, converted with the protocol library's parseAmount.
 */
export function readAmount(draft: string): { units: bigint } | { problem: AmountProblem } {
  const text = draft.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(?:\.\d{1,6})?$/.test(text)) return { problem: "format" };
  const units = parseAmount(text);
  if (units === null) return { problem: "too_large" };
  if (units === BigInt(0)) return { problem: "zero" };
  return { units };
}
