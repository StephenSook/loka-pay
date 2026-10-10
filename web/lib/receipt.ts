// Receipt checking for /verify (protocol/PAYMENT-V1.md section 4.9). Runs in the
// browser: nothing here makes a request or stores anything.
//
// The verdict always comes from verifyReceipt in @lokapay/protocol. The library throws
// only a code (for example "bad_signature"), and the same code can come from the note,
// the acknowledgement or the confirmation, so on a failure `locateFailure` replays the
// library's own steps in verifyReceipt's order to say which check failed. If the replay
// does not reproduce the library's code, the page says the check could not be located
// instead of guessing.

import {
  CONF_STATUS,
  PaymentError,
  SIZES,
  base64urlDecode,
  decodeTransport,
  displayAmount,
  equalBytes,
  fromHex,
  keyHash,
  toHex,
  validateNoteWire,
  verifyAckWire,
  verifyConfWire,
  verifyReceipt,
  type Deployment,
  type PaymentErrorCode,
  type ValidatedNote,
  type VerifiedReceipt,
} from "@lokapay/protocol";
import { encodeBase58 } from "./base58";

/** A deployment as plain strings, so a server component can pass it to the client. */
export interface SerializedDeployment {
  clusterId: number;
  programIdHex: string;
  programIdBase58: string;
  mintHex: string;
  mintBase58: string;
  serverPublicKeyHex: string;
}

const RECEIPT_MIN = SIZES.noteWire + SIZES.ackWire + 1; // 392: no confirmation attached
const RECEIPT_WITH_CONF = RECEIPT_MIN + SIZES.confWire; // 595
const NOTE_END = SIZES.noteWire; // 238
const ACK_END = NOTE_END + SIZES.ackWire; // 391
const PROGRAM_ID = { start: 16, end: 48 }; // NOTE_V1 offsets (section 4.1)

// ---------- input ----------

// The longest real input is a receipt link: about 30 characters of URL plus 794 base64url
// characters for a 595-byte receipt. Anything far past that is refused before decoding, so a
// huge paste or #r= link cannot make the tab decode and re-encode megabytes while rendering.
const MAX_INPUT_CHARS = 4096;

export type InputProblem =
  | { kind: "empty" }
  | { kind: "too_long"; length: number }
  | { kind: "no_fragment" }
  | { kind: "not_payment" }
  | { kind: "wrong_kind"; found: string }
  | { kind: "decode"; code: PaymentErrorCode };

export type ParsedInput =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; problem: InputProblem };

/** The receipt in a URL fragment ("#r=<base64url>"). The query string is never read. */
export function readFragment(hash: string): string | null {
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of body.split("&")) {
    if (part.startsWith("r=")) return part.slice(2);
  }
  return null;
}

/**
 * Accepts a receipt link (anything with "#r="), the fragment alone ("r=..."), the
 * transport form ("L1|P|1|X|<base64url>"), or the base64url bytes. Whitespace is
 * removed first because none of these forms contain any, and pasted text often wraps.
 */
export function parseReceiptText(input: string): ParsedInput {
  // Checked on the raw input too, so the whitespace strip never runs over a huge string.
  if (input.length > 4 * MAX_INPUT_CHARS) return { ok: false, problem: { kind: "too_long", length: input.length } };
  let text = input.replace(/\s+/g, "");
  if (text === "") return { ok: false, problem: { kind: "empty" } };
  if (text.length > MAX_INPUT_CHARS) return { ok: false, problem: { kind: "too_long", length: text.length } };

  if (text.startsWith("L1|")) {
    try {
      const decoded = decodeTransport(text);
      if (!decoded) return { ok: false, problem: { kind: "not_payment" } };
      if (decoded.kind !== "X") return { ok: false, problem: { kind: "wrong_kind", found: decoded.kind } };
      return { ok: true, bytes: decoded.payload };
    } catch (e) {
      if (e instanceof PaymentError) return { ok: false, problem: { kind: "decode", code: e.code } };
      throw e;
    }
  }

  const hashAt = text.indexOf("#");
  if (hashAt >= 0) {
    const fromLink = readFragment(text.slice(hashAt));
    if (fromLink === null) return { ok: false, problem: { kind: "no_fragment" } };
    text = fromLink;
  } else if (text.startsWith("r=")) {
    text = text.slice(2);
  }

  try {
    return { ok: true, bytes: base64urlDecode(text) };
  } catch (e) {
    if (e instanceof PaymentError) return { ok: false, problem: { kind: "decode", code: e.code } };
    throw e;
  }
}

// ---------- which deployment checks this receipt ----------

export type ContextKind = "test_vector" | "pinned";

/**
 * A note that carries the vector-only program id (protocol/vectors/payment-v1.json) is
 * checked against the vector deployment and the vector server key, and the page labels
 * it a test vector. Everything else is checked against the pinned deployment, or not at
 * all when no deployment is pinned yet.
 */
export function chooseContext(
  bytes: Uint8Array,
  pinned: SerializedDeployment | null,
  testVector: SerializedDeployment,
): { kind: ContextKind; deployment: SerializedDeployment } | null {
  if (
    bytes.length >= PROGRAM_ID.end &&
    equalBytes(bytes.slice(PROGRAM_ID.start, PROGRAM_ID.end), fromHex(testVector.programIdHex))
  ) {
    return { kind: "test_vector", deployment: testVector };
  }
  return pinned ? { kind: "pinned", deployment: pinned } : null;
}

function toDeployment(d: SerializedDeployment): Deployment {
  return { programId: fromHex(d.programIdHex), clusterId: d.clusterId, mint: fromHex(d.mintHex) };
}

// ---------- checks ----------

export type CheckId = "note" | "ack" | "conf" | "ids";
export type CheckState = "passed" | "failed" | "not_run" | "not_attached";
export type Checks = Record<CheckId, CheckState>;

/** "layout" is the receipt's own framing: its length and its confirmation flag. */
export type Stage = "layout" | CheckId;

/** Which part of an acknowledgement failed to match the note (payee_mismatch). */
export type AckMismatch = "note_id" | "payee" | "both";

interface Located {
  stage: Stage;
  code: PaymentErrorCode;
  checks: Checks;
  ackMismatch?: AckMismatch;
}

const NONE_RUN: Checks = { note: "not_run", ack: "not_run", conf: "not_run", ids: "not_run" };

function codeOf(e: unknown): PaymentErrorCode {
  if (e instanceof PaymentError) return e.code;
  throw e;
}

function ackMismatchOf(bytes: Uint8Array, note: ValidatedNote): AckMismatch {
  const ack = bytes.slice(NOTE_END, ACK_END);
  const idDiffers = !equalBytes(ack.slice(16, 48), note.noteId);
  const payeeDiffers = !equalBytes(keyHash(ack.slice(120, 153)), note.note.payeeKeyHash);
  if (idDiffers && payeeDiffers) return "both";
  return idDiffers ? "note_id" : "payee";
}

/** Replays verifyReceipt's steps in its order and returns the first failure, or null. */
export function locateFailure(bytes: Uint8Array, deployment: Deployment, serverKey: Uint8Array): Located | null {
  if (bytes.length < RECEIPT_MIN) return { stage: "layout", code: "length", checks: NONE_RUN };

  let note: ValidatedNote;
  try {
    note = validateNoteWire(bytes.slice(0, NOTE_END), deployment);
  } catch (e) {
    return { stage: "note", code: codeOf(e), checks: { ...NONE_RUN, note: "failed" } };
  }

  try {
    verifyAckWire(bytes.slice(NOTE_END, ACK_END), note);
  } catch (e) {
    const code = codeOf(e);
    return {
      stage: "ack",
      code,
      checks: { ...NONE_RUN, note: "passed", ack: "failed" },
      ackMismatch: code === "payee_mismatch" ? ackMismatchOf(bytes, note) : undefined,
    };
  }

  const throughAck: Checks = { ...NONE_RUN, note: "passed", ack: "passed" };
  const flag = bytes[ACK_END];
  if (flag === 0) {
    return bytes.length === RECEIPT_MIN ? null : { stage: "layout", code: "length", checks: throughAck };
  }
  if (flag !== 1) return { stage: "layout", code: "receipt_flag", checks: throughAck };
  if (bytes.length !== RECEIPT_WITH_CONF) return { stage: "layout", code: "length", checks: throughAck };

  let confNoteId: Uint8Array;
  try {
    confNoteId = verifyConfWire(bytes.slice(RECEIPT_MIN), serverKey).noteId;
  } catch (e) {
    return { stage: "conf", code: codeOf(e), checks: { ...throughAck, conf: "failed" } };
  }
  if (!equalBytes(confNoteId, note.noteId)) {
    return { stage: "ids", code: "confirmation_mismatch", checks: { ...throughAck, conf: "passed", ids: "failed" } };
  }
  return null;
}

// ---------- what the page shows ----------

export type ReceiptStatus = VerifiedReceipt["status"];

export interface ConfirmationView {
  statusCode: 1 | 2 | 3;
  errorCode: number;
  slot: bigint;
  blockTime: bigint;
  uploadedAt: bigint;
  txSignatureBase58: string;
  /** Only for status 1 (settled) and 2 (failed on chain); a refused note has no transaction. */
  explorerUrl: string | null;
}

export interface ReceiptView {
  status: ReceiptStatus;
  amount: string;
  payeeKeyHashHex: string;
  payerKeyHashHex: string;
  noteIdHex: string;
  allowanceId: string;
  serial: number;
  expiry: bigint;
  receivedAt: bigint;
  conf: ConfirmationView | null;
  /** CONF uploaded at minus ACK received at: server clock minus merchant phone clock. */
  heldOfflineSeconds: bigint | null;
}

export function explorerUrl(txSignature: Uint8Array): string {
  return `https://explorer.solana.com/tx/${encodeBase58(txSignature)}?cluster=devnet`;
}

function toView(r: VerifiedReceipt): ReceiptView {
  const conf: ConfirmationView | null = r.conf
    ? {
        statusCode: r.conf.status,
        errorCode: r.conf.errorCode,
        slot: r.conf.slot,
        blockTime: r.conf.blockTime,
        uploadedAt: r.conf.uploadedAt,
        txSignatureBase58: encodeBase58(r.conf.txSignature),
        explorerUrl:
          r.conf.status === CONF_STATUS.settled || r.conf.status === CONF_STATUS.failed_on_chain
            ? explorerUrl(r.conf.txSignature)
            : null,
      }
    : null;
  return {
    status: r.status,
    amount: displayAmount(r.note.note.amount),
    payeeKeyHashHex: toHex(r.note.note.payeeKeyHash),
    payerKeyHashHex: toHex(r.note.payerKeyHash),
    noteIdHex: toHex(r.note.noteId),
    allowanceId: r.note.note.allowanceId.toString(),
    serial: r.note.note.serial,
    expiry: r.note.note.expiry,
    receivedAt: r.ack.receivedAt,
    conf,
    heldOfflineSeconds: conf ? conf.uploadedAt - r.ack.receivedAt : null,
  };
}

export type Evaluation =
  | { kind: "input"; problem: InputProblem }
  | { kind: "no_deployment"; tooShort: boolean }
  | {
      kind: "verified";
      context: ContextKind;
      view: ReceiptView;
      checks: Checks;
      /** The receipt bytes that verified, for "Play the attacker" (lib/attacker.ts). */
      bytes: Uint8Array;
    }
  | {
      kind: "failed";
      context: ContextKind;
      code: PaymentErrorCode;
      /** null when the replay could not reproduce the library's failure. */
      located: Located | null;
    }
  | { kind: "unexpected"; message: string };

export function evaluate(
  text: string,
  pinned: SerializedDeployment | null,
  testVector: SerializedDeployment,
): Evaluation {
  const parsed = parseReceiptText(text);
  if (!parsed.ok) return { kind: "input", problem: parsed.problem };
  return evaluateBytes(parsed.bytes, pinned, testVector);
}

/**
 * Every check on receipt bytes. The receipt box and "Play the attacker" (lib/attacker.ts)
 * both call this, so an edited note goes through exactly the check that verified the
 * original.
 */
export function evaluateBytes(
  bytes: Uint8Array,
  pinned: SerializedDeployment | null,
  testVector: SerializedDeployment,
): Evaluation {
  const context = chooseContext(bytes, pinned, testVector);
  // Nothing to check against. The length rule needs no deployment, so a too-short
  // input is still named as one.
  if (!context) return { kind: "no_deployment", tooShort: bytes.length < RECEIPT_MIN };

  const deployment = toDeployment(context.deployment);
  const serverKey = fromHex(context.deployment.serverPublicKeyHex);
  try {
    const receipt = verifyReceipt(bytes, deployment, serverKey);
    const checks: Checks = {
      note: "passed",
      ack: "passed",
      conf: receipt.conf ? "passed" : "not_attached",
      ids: "passed",
    };
    return { kind: "verified", context: context.kind, view: toView(receipt), checks, bytes };
  } catch (e) {
    if (!(e instanceof PaymentError)) {
      return { kind: "unexpected", message: e instanceof Error ? e.message : String(e) };
    }
    let located: Located | null = null;
    try {
      located = locateFailure(bytes, deployment, serverKey);
    } catch {
      located = null;
    }
    return {
      kind: "failed",
      context: context.kind,
      code: e.code,
      located: located && located.code === e.code ? located : null,
    };
  }
}

// ---------- words ----------

/** Every PaymentError code in plain words. A Record, so a new code fails the typecheck. */
export const ERROR_WORDS: Record<PaymentErrorCode, string> = {
  length: "The bytes are not the length this structure must have.",
  prefix: "The structure does not start with its LOKA-PAY domain prefix.",
  cluster: "The note is for a different Solana cluster than this deployment.",
  currency: "The note's currency is not USD.",
  amount_zero: "The note's amount is zero.",
  wrong_program: "The note names a different program id than this deployment's.",
  wrong_mint: "The note names a different token mint than this deployment's.",
  bad_pubkey: "The public key is not a valid compressed P-256 point.",
  high_s: "The signature is not in low-S form, so the Solana precompile would reject it.",
  bad_signature: "The signature does not match the signed bytes and the signer's public key.",
  base64url: "The text is not valid base64url (RFC 4648 section 5, no padding).",
  hex: "The text is not valid hex.",
  earmark_mismatch: "The earmark list does not match the hash the certificate signs.",
  earmark_list: "The earmark list is malformed.",
  name_length: "The display name has an invalid length or form.",
  receipt_flag: "The confirmation flag byte is neither 0 (no confirmation) nor 1 (confirmation attached).",
  payee_mismatch: "The acknowledgement does not belong to this note.",
  confirmation_mismatch: "The server confirmation names a different note id than this note.",
};

export const ACK_MISMATCH_WORDS: Record<AckMismatch, string> = {
  note_id: "It names a different note id.",
  payee: "The merchant key that signed it is not the note's payee.",
  both: "It names a different note id, and the merchant key that signed it is not the note's payee.",
};

export const CHECK_LABELS: Record<CheckId, { title: string; detail: string }> = {
  note: {
    title: "Note signature",
    detail:
      "The payer's P-256 signature verifies over the 141 note bytes, after the section 6 checks: cluster, currency, amount, program id, mint, public key and low-S.",
  },
  ack: {
    title: "Merchant acknowledgement",
    detail: "The merchant's P-256 signature verifies, and the merchant's key hash is the note's payee key hash.",
  },
  conf: {
    title: "Server confirmation signature",
    detail: "The settlement server's Ed25519 signature over the confirmation verifies with the server key.",
  },
  ids: {
    title: "Ids match",
    detail: "The acknowledgement and the confirmation both name this note's id.",
  },
};

export const STAGE_WORDS: Record<Stage, string> = {
  layout: "Receipt layout (its length and its confirmation flag)",
  note: CHECK_LABELS.note.title,
  ack: CHECK_LABELS.ack.title,
  conf: CHECK_LABELS.conf.title,
  ids: CHECK_LABELS.ids.title,
};

export const TRANSPORT_KIND_WORDS: Record<string, string> = {
  N: "a note",
  Y: "an acknowledgement",
  S: "a confirmation",
  M: "a spend marker",
  A: "an allowance certificate",
  C: "a merchant certificate",
};

// ---------- formatting ----------

const MAX_DATE_SECONDS = BigInt(8_640_000_000_000); // the range of a JavaScript Date

/** "2026-10-10 12:00:00 UTC". Out-of-range values (i64 allows them) come back as null. */
export function formatUnixUtc(seconds: bigint): string | null {
  if (seconds > MAX_DATE_SECONDS || seconds < -MAX_DATE_SECONDS) return null;
  // Split at "T" rather than slicing fixed offsets: years past 9999 print as "+010000-01-01".
  const [date, time] = new Date(Number(seconds) * 1000).toISOString().split("T");
  return `${date} ${time.slice(0, 8)} UTC`;
}

/** "1 h 2 min 5 s". Negative when the two clocks disagree. */
export function formatDuration(seconds: bigint): string {
  const negative = seconds < BigInt(0);
  let rest = negative ? -seconds : seconds;
  const day = BigInt(86_400);
  const hour = BigInt(3_600);
  const minute = BigInt(60);
  const parts: string[] = [];
  const d = rest / day;
  rest %= day;
  const h = rest / hour;
  rest %= hour;
  const m = rest / minute;
  const s = rest % minute;
  if (d > BigInt(0)) parts.push(`${d} d`);
  if (h > BigInt(0)) parts.push(`${h} h`);
  if (m > BigInt(0)) parts.push(`${m} min`);
  if (s > BigInt(0) || parts.length === 0) parts.push(`${s} s`);
  return (negative ? "-" : "") + parts.join(" ");
}
