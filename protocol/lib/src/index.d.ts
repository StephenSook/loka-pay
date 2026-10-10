// Types for @lokapay/protocol (src/index.js). Keep in step with index.js; test/types-check.ts
// is compiled by `pnpm typecheck` so a drifted signature fails CI.

export type Bytes = Uint8Array;

export interface Deployment {
  programId: Bytes;
  clusterId: number;
  mint: Bytes;
}

export type PaymentErrorCode =
  | 'length' | 'prefix' | 'cluster' | 'currency' | 'amount_zero' | 'wrong_program' | 'wrong_mint'
  | 'bad_pubkey' | 'high_s' | 'bad_signature' | 'base64url' | 'hex' | 'earmark_mismatch'
  | 'earmark_list' | 'name_length' | 'receipt_flag' | 'payee_mismatch' | 'confirmation_mismatch';

export class PaymentError extends Error {
  readonly code: PaymentErrorCode;
  constructor(code: PaymentErrorCode);
}

export const PREFIX: Readonly<Record<'note' | 'ack' | 'conf' | 'allow' | 'merch' | 'withdraw' | 'refund', string>>;
export const SIZES: Readonly<{
  NOTE_V1: 141; noteWire: 238; ACK_V1: 56; ackWire: 153; CONF_V1: 139; confWire: 203;
  ALLOW_V1: 185; WITHDRAW_V1: 161; REFUND_V1: 137;
}>;
export const CONF_STATUS: Readonly<{ settled: 1; failed_on_chain: 2; refused_off_chain: 3 }>;
export const SECP256R1_PROGRAM_ID: string;
export const INSTRUCTIONS_SYSVAR_ID: string;

export function toHex(b: Bytes): string;
export function fromHex(h: string): Bytes;
export function equalBytes(a: Bytes, b: Bytes): boolean;

export function keyHash(compressedPublicKey: Bytes): Bytes;
export function isLowS(signature: Bytes): boolean;
export function normalizeLowS(signature: Bytes): Bytes;
export function verifyP256(signature: Bytes, message: Bytes, compressedPublicKey: Bytes): void;
export function verifyEd25519(signature: Bytes, message: Bytes, publicKey: Bytes): void;

export interface NoteFields {
  allowanceId: bigint;
  payeeKeyHash: Bytes;
  amount: bigint;
  serial: number;
  expiry: bigint;
  currency?: string;
}
export interface Note extends Required<NoteFields> {
  programId: Bytes;
  clusterId: number;
  mint: Bytes;
}
export interface ValidatedNote {
  note: Note;
  noteBytes: Bytes;
  signature: Bytes;
  payerPublicKey: Bytes;
  noteId: Bytes;
  payerKeyHash: Bytes;
}
export function encodeNote(deployment: Deployment, fields: NoteFields): Bytes;
export function decodeNote(bytes: Bytes): Note;
export function noteId(noteBytes: Bytes): Bytes;
export function validateNoteWire(wire: Bytes, deployment: Deployment): ValidatedNote;

export interface VerifiedAck { noteId: Bytes; receivedAt: bigint; merchantPublicKey: Bytes }
export function encodeAck(noteId: Bytes, receivedAt: bigint): Bytes;
export function verifyAckWire(wire: Bytes, validated: ValidatedNote): VerifiedAck;

export type ConfStatusName = 'settled' | 'failed_on_chain' | 'refused_off_chain';
export interface ConfFields {
  noteId: Bytes;
  txSignature: Bytes;
  slot: bigint;
  blockTime: bigint;
  uploadedAt: bigint;
  status: ConfStatusName | 1 | 2 | 3;
  errorCode?: number;
}
export interface VerifiedConf {
  noteId: Bytes; txSignature: Bytes; slot: bigint; blockTime: bigint; uploadedAt: bigint;
  status: 1 | 2 | 3; errorCode: number;
}
export function encodeConf(fields: ConfFields): Bytes;
export function signConfWire(fields: ConfFields, secretKey: Bytes): Bytes;
export function verifyConfWire(wire: Bytes, serverPublicKey: Bytes): VerifiedConf;

export function encodeEarmarks(hashes: Bytes[]): Bytes;
export function earmarkHash(list: Bytes): Bytes;
export function decodeEarmarks(list: Bytes): Bytes[];

export interface AllowFields {
  allowanceId: bigint;
  payerKeyHash: Bytes;
  cap: bigint;
  offlineLimit: bigint;
  expiry: bigint;
  earmarkList: Bytes;
  bond: bigint;
}
export interface VerifiedAllow {
  allowanceId: bigint; payerKeyHash: Bytes; cap: bigint; offlineLimit: bigint; expiry: bigint;
  earmarks: Bytes[]; bond: bigint;
}
export function encodeAllow(deployment: Deployment, fields: AllowFields): Bytes;
export function signAllowWire(deployment: Deployment, fields: AllowFields, secretKey: Bytes): Bytes;
export function verifyAllowWire(wire: Bytes, deployment: Deployment, serverPublicKey: Bytes): VerifiedAllow;

export interface MerchFields { merchantKeyHash: Bytes; displayName: string }
export function encodeMerch(deployment: Deployment, fields: MerchFields): Bytes;
export function signMerchWire(deployment: Deployment, fields: MerchFields, secretKey: Bytes): Bytes;
export function verifyMerchWire(wire: Bytes, deployment: Deployment, serverPublicKey: Bytes): MerchFields;

export function encodeWithdraw(
  deployment: Deployment,
  fields: { merchantKeyHash: Bytes; destination: Bytes; amount: bigint; counter: bigint },
): Bytes;
export function encodeRefund(
  deployment: Deployment,
  fields: { noteId: Bytes; allowanceId: bigint; amount: bigint; counter: bigint },
): Bytes;

export function markerBundle(noteWire: Bytes, ackWire: Bytes): Bytes;
export function receiptBundle(noteWire: Bytes, ackWire: Bytes, confWire: Bytes | null): Bytes;
export interface VerifiedReceipt {
  note: ValidatedNote;
  ack: VerifiedAck;
  conf: VerifiedConf | null;
  status: 'pending' | ConfStatusName;
}
export function verifyReceipt(bytes: Bytes, deployment: Deployment, serverPublicKey: Bytes): VerifiedReceipt;
export function isEquivocation(a: ValidatedNote, b: ValidatedNote, certificate: VerifiedAllow): boolean;

export type TransportKind = 'N' | 'Y' | 'S' | 'M' | 'X' | 'A' | 'C';
export function base64urlEncode(b: Bytes): string;
export function base64urlDecode(text: string): Bytes;
export function encodeTransport(kind: TransportKind, payload: Bytes): string;
export function decodeTransport(text: string): { kind: TransportKind; payload: Bytes } | null;

export function displayAmount(baseUnits: bigint | number | string): string;
export function parseAmount(text: string): bigint | null;

export function secp256r1InstructionData(
  entries: Array<{ publicKey: Bytes; signature: Bytes; message: Bytes }>,
): Bytes;
