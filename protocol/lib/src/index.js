// @lokapay/protocol: PAYMENT-V1 encode, decode and verify for the server and the web.
// Spec: protocol/PAYMENT-V1.md. Vectors: protocol/vectors/payment-v1.json (test/vectors.test.js).
// Plain ESM with a hand-written index.d.ts, so TypeScript and JavaScript callers import it
// without a build step. All u64 amounts and ids are bigint.

import { p256 } from '@noble/curves/nist.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base64urlnopad } from '@scure/base';

const enc = new TextEncoder();
const dec = new TextDecoder('ascii', { fatal: true });

export const PREFIX = Object.freeze({
  note: 'LOKA-PAY-NOTE-V1',
  ack: 'LOKA-PAY-ACKN-V1',
  conf: 'LOKA-PAY-CONF-V1',
  allow: 'LOKA-PAY-ALLW-V1',
  merch: 'LOKA-PAY-MRCH-V1',
  withdraw: 'LOKA-PAY-WDRW-V1',
  refund: 'LOKA-PAY-RFND-V1',
});

export const SIZES = Object.freeze({
  NOTE_V1: 141,
  noteWire: 238,
  ACK_V1: 56,
  ackWire: 153,
  CONF_V1: 139,
  confWire: 203,
  ALLOW_V1: 185,
  WITHDRAW_V1: 161,
  REFUND_V1: 137,
});

export const CONF_STATUS = Object.freeze({ settled: 1, failed_on_chain: 2, refused_off_chain: 3 });
export const SECP256R1_PROGRAM_ID = 'Secp256r1SigVerify1111111111111111111111111';
export const INSTRUCTIONS_SYSVAR_ID = 'Sysvar1nstructions1111111111111111111111111';

const P256_N = p256.Point.Fn.ORDER;
const P256_HALF_N = P256_N >> 1n;

/** A failure named exactly as in PAYMENT-V1.md (for example "high_s", "bad_signature"). */
export class PaymentError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PaymentError';
    this.code = code;
  }
}
const fail = (code) => {
  throw new PaymentError(code);
};

// ---------- bytes ----------

export const toHex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
export const fromHex = (h) => {
  if (typeof h !== 'string' || h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) fail('hex');
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};
export const equalBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

class Writer {
  constructor() {
    this.parts = [];
  }
  bytes(b, len) {
    if (!(b instanceof Uint8Array) || b.length !== len) throw new RangeError(`field must be ${len} bytes`);
    this.parts.push(b);
    return this;
  }
  ascii(s, len) {
    return this.bytes(enc.encode(s), len);
  }
  u8(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xff) throw new RangeError('u8 out of range');
    return this.bytes(Uint8Array.of(n), 1);
  }
  u16(n) {
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError('u16 out of range');
    return this.bytes(Uint8Array.of(n >> 8, n & 0xff), 2);
  }
  u64(v) {
    const n = BigInt(v);
    if (n < 0n || n > 0xffffffffffffffffn) throw new RangeError('u64 out of range');
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, n, false);
    return this.bytes(b, 8);
  }
  i64(v) {
    const n = BigInt(v);
    if (n < -(2n ** 63n) || n > 2n ** 63n - 1n) throw new RangeError('i64 out of range');
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigInt64(0, n, false);
    return this.bytes(b, 8);
  }
  done() {
    return concat(...this.parts);
  }
}

class Reader {
  constructor(b) {
    this.b = b;
    this.o = 0;
  }
  get remaining() {
    return this.b.length - this.o;
  }
  read(n) {
    if (this.remaining < n) fail('length');
    const out = this.b.slice(this.o, this.o + n);
    this.o += n;
    return out;
  }
  u8() {
    return this.read(1)[0];
  }
  u16() {
    const b = this.read(2);
    return (b[0] << 8) | b[1];
  }
  u64() {
    return new DataView(this.read(8).buffer).getBigUint64(0, false);
  }
  i64() {
    return new DataView(this.read(8).buffer).getBigInt64(0, false);
  }
}

// ---------- P-256 and Ed25519 rules (section 3) ----------

export const keyHash = (compressedPublicKey) => sha256(compressedPublicKey);

export const isLowS = (sig) => sig.length === 64 && BigInt('0x' + toHex(sig.slice(32))) <= P256_HALF_N;

export const normalizeLowS = (sig) => {
  if (sig.length !== 64) throw new RangeError('raw P-256 signature must be 64 bytes');
  const s = BigInt('0x' + toHex(sig.slice(32)));
  if (s <= P256_HALF_N) return Uint8Array.from(sig);
  return concat(sig.slice(0, 32), fromHex((P256_N - s).toString(16).padStart(64, '0')));
};

/** Throws bad_pubkey, high_s or bad_signature. SHA-256 is applied to `message` inside. */
export function verifyP256(signature, message, compressedPublicKey) {
  if (compressedPublicKey.length !== 33 || (compressedPublicKey[0] !== 2 && compressedPublicKey[0] !== 3)) fail('bad_pubkey');
  try {
    p256.Point.fromBytes(compressedPublicKey);
  } catch {
    fail('bad_pubkey');
  }
  if (signature.length !== 64) fail('bad_signature');
  if (!isLowS(signature)) fail('high_s');
  let ok = false;
  try {
    ok = p256.verify(signature, message, compressedPublicKey);
  } catch {
    ok = false;
  }
  if (!ok) fail('bad_signature');
}

export function verifyEd25519(signature, message, publicKey) {
  let ok = false;
  try {
    ok = signature.length === 64 && ed25519.verify(signature, message, publicKey);
  } catch {
    ok = false;
  }
  if (!ok) fail('bad_signature');
}

// ---------- NOTE_V1 (section 4.1) and validation (section 6) ----------

/** @param {{programId:Uint8Array, clusterId:number, mint:Uint8Array}} d */
export function encodeNote(d, f) {
  return new Writer()
    .ascii(PREFIX.note, 16)
    .bytes(d.programId, 32)
    .u8(d.clusterId)
    .bytes(d.mint, 32)
    .u64(f.allowanceId)
    .bytes(f.payeeKeyHash, 32)
    .u64(f.amount)
    .ascii(f.currency ?? 'USD', 3)
    .u8(f.serial)
    .i64(f.expiry)
    .done();
}

export function decodeNote(bytes) {
  if (bytes.length !== SIZES.NOTE_V1) fail('length');
  const r = new Reader(bytes);
  if (!equalBytes(r.read(16), enc.encode(PREFIX.note))) fail('prefix');
  const programId = r.read(32);
  const clusterId = r.u8();
  const mint = r.read(32);
  const allowanceId = r.u64();
  const payeeKeyHash = r.read(32);
  const amount = r.u64();
  let currency = '';
  try {
    currency = dec.decode(r.read(3));
  } catch {
    currency = '';
  }
  const serial = r.u8();
  const expiry = r.i64();
  return { programId, clusterId, mint, allowanceId, payeeKeyHash, amount, currency, serial, expiry };
}

export const noteId = (noteBytes) => sha256(noteBytes);

/**
 * Runs the checks of PAYMENT-V1.md section 6 in order; throws the first failure by name.
 * Returns the decoded note with its bytes, signature, payer key, note id and payer key hash.
 */
export function validateNoteWire(wire, deployment) {
  if (wire.length !== SIZES.noteWire) fail('length');
  const noteBytes = wire.slice(0, 141);
  if (!equalBytes(noteBytes.slice(0, 16), enc.encode(PREFIX.note))) fail('prefix');
  const note = decodeNote(noteBytes);
  if (note.clusterId !== deployment.clusterId) fail('cluster');
  if (note.currency !== 'USD') fail('currency');
  if (note.amount === 0n) fail('amount_zero');
  if (!equalBytes(note.programId, deployment.programId)) fail('wrong_program');
  if (!equalBytes(note.mint, deployment.mint)) fail('wrong_mint');
  const signature = wire.slice(141, 205);
  const payerPublicKey = wire.slice(205, 238);
  verifyP256(signature, noteBytes, payerPublicKey);
  return { note, noteBytes, signature, payerPublicKey, noteId: sha256(noteBytes), payerKeyHash: sha256(payerPublicKey) };
}

// ---------- ACK, CONF (sections 4.2, 4.3) ----------

export const encodeAck = (id, receivedAt) => new Writer().ascii(PREFIX.ack, 16).bytes(id, 32).i64(receivedAt).done();

/** Verifies an ack wire for a validated note (key hash must be the payee). */
export function verifyAckWire(wire, validated) {
  if (wire.length !== SIZES.ackWire) fail('length');
  const body = wire.slice(0, 56);
  const r = new Reader(body);
  if (!equalBytes(r.read(16), enc.encode(PREFIX.ack))) fail('prefix');
  const id = r.read(32);
  const receivedAt = r.i64();
  const merchantPublicKey = wire.slice(120, 153);
  if (!equalBytes(id, validated.noteId) || !equalBytes(sha256(merchantPublicKey), validated.note.payeeKeyHash)) fail('payee_mismatch');
  verifyP256(wire.slice(56, 120), body, merchantPublicKey);
  return { noteId: id, receivedAt, merchantPublicKey };
}

export function encodeConf(f) {
  const status = typeof f.status === 'string' ? CONF_STATUS[f.status] : f.status;
  if (![1, 2, 3].includes(status)) throw new RangeError('status must be 1, 2 or 3');
  return new Writer()
    .ascii(PREFIX.conf, 16)
    .bytes(f.noteId, 32)
    .bytes(f.txSignature, 64)
    .u64(f.slot)
    .i64(f.blockTime)
    .i64(f.uploadedAt)
    .u8(status)
    .u16(f.errorCode ?? 0)
    .done();
}

/** Server side: CONF_V1 || Ed25519 signature. `secretKey` is the 32-byte Ed25519 seed. */
export function signConfWire(f, secretKey) {
  const body = encodeConf(f);
  return concat(body, ed25519.sign(body, secretKey));
}

export function verifyConfWire(wire, serverPublicKey) {
  if (wire.length !== SIZES.confWire) fail('length');
  const body = wire.slice(0, SIZES.CONF_V1);
  verifyEd25519(wire.slice(SIZES.CONF_V1), body, serverPublicKey);
  const r = new Reader(body);
  if (!equalBytes(r.read(16), enc.encode(PREFIX.conf))) fail('prefix');
  const id = r.read(32);
  const txSignature = r.read(64);
  const slot = r.u64();
  const blockTime = r.i64();
  const uploadedAt = r.i64();
  const status = r.u8();
  if (![1, 2, 3].includes(status)) fail('length');
  const errorCode = r.u16();
  return { noteId: id, txSignature, slot, blockTime, uploadedAt, status, errorCode };
}

// ---------- earmarks, ALLOW, MERCH (sections 4.4 to 4.6) ----------

const cmp = (a, b) => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

export function encodeEarmarks(hashes) {
  const sorted = [...hashes].sort(cmp);
  if (sorted.length > 16 || sorted.some((h) => h.length !== 32)) fail('earmark_list');
  for (let i = 1; i < sorted.length; i++) if (cmp(sorted[i - 1], sorted[i]) === 0) fail('earmark_list');
  const w = new Writer().u16(sorted.length);
  for (const h of sorted) w.bytes(h, 32);
  return w.done();
}
export const earmarkHash = (list) => sha256(list);
export function decodeEarmarks(list) {
  const r = new Reader(list);
  const n = r.u16();
  if (n > 16 || r.remaining !== n * 32) fail('earmark_list');
  const hashes = Array.from({ length: n }, () => r.read(32));
  if (!equalBytes(encodeEarmarks(hashes), list)) fail('earmark_list');
  return hashes;
}

export function encodeAllow(d, f) {
  return new Writer()
    .ascii(PREFIX.allow, 16)
    .bytes(d.programId, 32)
    .u8(d.clusterId)
    .bytes(d.mint, 32)
    .u64(f.allowanceId)
    .bytes(f.payerKeyHash, 32)
    .u64(f.cap)
    .u64(f.offlineLimit)
    .i64(f.expiry)
    .bytes(earmarkHash(f.earmarkList), 32)
    .u64(f.bond)
    .done();
}

/** Server side: ALLOW_V1 || Ed25519 signature || earmark list. */
export function signAllowWire(d, f, secretKey) {
  const body = encodeAllow(d, f);
  return concat(body, ed25519.sign(body, secretKey), f.earmarkList);
}

export function verifyAllowWire(wire, d, serverPublicKey) {
  if (wire.length < SIZES.ALLOW_V1 + 64 + 2) fail('length');
  const body = wire.slice(0, SIZES.ALLOW_V1);
  verifyEd25519(wire.slice(SIZES.ALLOW_V1, SIZES.ALLOW_V1 + 64), body, serverPublicKey);
  const list = wire.slice(SIZES.ALLOW_V1 + 64);
  const r = new Reader(body);
  if (!equalBytes(r.read(16), enc.encode(PREFIX.allow))) fail('prefix');
  if (!equalBytes(r.read(32), d.programId)) fail('wrong_program');
  if (r.u8() !== d.clusterId) fail('cluster');
  if (!equalBytes(r.read(32), d.mint)) fail('wrong_mint');
  const allowanceId = r.u64();
  const payerKeyHash = r.read(32);
  const cap = r.u64();
  const offlineLimit = r.u64();
  const expiry = r.i64();
  const listHash = r.read(32);
  const bond = r.u64();
  if (!equalBytes(earmarkHash(list), listHash)) fail('earmark_mismatch');
  return { allowanceId, payerKeyHash, cap, offlineLimit, expiry, earmarks: decodeEarmarks(list), bond };
}

export function encodeMerch(d, f) {
  const name = enc.encode(f.displayName.normalize('NFC'));
  if (name.length < 1 || name.length > 64) fail('name_length');
  return new Writer()
    .ascii(PREFIX.merch, 16)
    .bytes(d.programId, 32)
    .u8(d.clusterId)
    .bytes(d.mint, 32)
    .bytes(f.merchantKeyHash, 32)
    .u16(name.length)
    .bytes(name, name.length)
    .done();
}

export function signMerchWire(d, f, secretKey) {
  const body = encodeMerch(d, f);
  return concat(body, ed25519.sign(body, secretKey));
}

export function verifyMerchWire(wire, d, serverPublicKey) {
  if (wire.length < 115 + 1 + 64) fail('length');
  const body = wire.slice(0, wire.length - 64);
  verifyEd25519(wire.slice(wire.length - 64), body, serverPublicKey);
  const r = new Reader(body);
  if (!equalBytes(r.read(16), enc.encode(PREFIX.merch))) fail('prefix');
  if (!equalBytes(r.read(32), d.programId)) fail('wrong_program');
  if (r.u8() !== d.clusterId) fail('cluster');
  if (!equalBytes(r.read(32), d.mint)) fail('wrong_mint');
  const merchantKeyHash = r.read(32);
  const n = r.u16();
  if (n < 1 || n > 64 || r.remaining !== n) fail('name_length');
  const displayName = new TextDecoder('utf-8', { fatal: true }).decode(r.read(n));
  if (displayName !== displayName.normalize('NFC')) fail('name_length');
  return { merchantKeyHash, displayName };
}

// ---------- WITHDRAW, REFUND (sections 4.7, 4.8) ----------

export function encodeWithdraw(d, f) {
  return new Writer()
    .ascii(PREFIX.withdraw, 16)
    .bytes(d.programId, 32)
    .u8(d.clusterId)
    .bytes(d.mint, 32)
    .bytes(f.merchantKeyHash, 32)
    .bytes(f.destination, 32)
    .u64(f.amount)
    .u64(f.counter)
    .done();
}

export function encodeRefund(d, f) {
  return new Writer()
    .ascii(PREFIX.refund, 16)
    .bytes(d.programId, 32)
    .u8(d.clusterId)
    .bytes(d.mint, 32)
    .bytes(f.noteId, 32)
    .u64(f.allowanceId)
    .u64(f.amount)
    .u64(f.counter)
    .done();
}

// ---------- bundles and checks (sections 4.9, 6) ----------

export const markerBundle = (noteWire, ackWire) => concat(noteWire, ackWire);
export const receiptBundle = (noteWire, ackWire, confWire) =>
  confWire ? concat(noteWire, ackWire, Uint8Array.of(1), confWire) : concat(noteWire, ackWire, Uint8Array.of(0));

/**
 * Verifies a receipt and returns its status from the matching signed CONF (never from the
 * flag): "pending", "settled", "failed_on_chain" or "refused_off_chain".
 */
export function verifyReceipt(bytes, deployment, serverPublicKey) {
  if (bytes.length < SIZES.noteWire + SIZES.ackWire + 1) fail('length');
  const note = validateNoteWire(bytes.slice(0, 238), deployment);
  const ack = verifyAckWire(bytes.slice(238, 391), note);
  const flag = bytes[391];
  let conf = null;
  if (flag === 0) {
    if (bytes.length !== 392) fail('length');
  } else if (flag === 1) {
    if (bytes.length !== 392 + SIZES.confWire) fail('length');
    conf = verifyConfWire(bytes.slice(392), serverPublicKey);
    if (!equalBytes(conf.noteId, note.noteId)) fail('confirmation_mismatch');
  } else {
    fail('receipt_flag');
  }
  const status = conf ? ['', 'settled', 'failed_on_chain', 'refused_off_chain'][conf.status] : 'pending';
  return { note, ack, conf, status };
}

/** True only for a real equivocation against `certificate` (section 4.9). */
export function isEquivocation(a, b, certificate) {
  return (
    a.note.allowanceId === certificate.allowanceId &&
    b.note.allowanceId === certificate.allowanceId &&
    a.note.serial === b.note.serial &&
    !equalBytes(a.noteId, b.noteId) &&
    equalBytes(a.payerKeyHash, certificate.payerKeyHash) &&
    equalBytes(b.payerKeyHash, certificate.payerKeyHash)
  );
}

// ---------- transport and units (sections 5, 4.1) ----------

const KINDS = new Set(['N', 'Y', 'S', 'M', 'X', 'A', 'C']);

export const base64urlEncode = (b) => base64urlnopad.encode(b);
export function base64urlDecode(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) fail('base64url');
  let out;
  try {
    out = base64urlnopad.decode(text);
  } catch {
    fail('base64url');
  }
  if (base64urlnopad.encode(out) !== text) fail('base64url');
  return out;
}

export const encodeTransport = (kind, payload) => {
  if (!KINDS.has(kind)) throw new RangeError('unknown kind');
  return `L1|P|1|${kind}|${base64urlEncode(payload)}`;
};

/** Returns null for anything that is not version-1 payment content; throws on a malformed payload. */
export function decodeTransport(text) {
  const parts = text.split('|');
  if (parts.length < 3 || parts[0] !== 'L1' || parts[1] !== 'P' || parts[2] !== '1') return null;
  if (parts.length !== 5 || !KINDS.has(parts[3])) return null;
  return { kind: parts[3], payload: base64urlDecode(parts[4]) };
}

const SCALE = 1_000_000n;
export function displayAmount(baseUnits) {
  const v = BigInt(baseUnits);
  const whole = v / SCALE;
  const frac = v % SCALE;
  if (frac % 10_000n === 0n) return `${whole}.${(frac / 10_000n).toString().padStart(2, '0')}`;
  return `${whole}.${frac.toString().padStart(6, '0')}`;
}
export function parseAmount(text) {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text);
  if (!m) return null;
  const v = BigInt(m[1]) * SCALE + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
  return v > 0xffffffffffffffffn ? null : v;
}

// ---------- Solana precompile data (section 7) ----------

/**
 * secp256r1 precompile instruction data for one or more signatures, in the SDK helper's
 * layout: [count][pad][count x 14-byte LE offsets][pubkey 33][signature 64][message]...
 * One NOTE_V1 gives 254 bytes. Every instruction index is 0xFFFF (this instruction).
 */
export function secp256r1InstructionData(entries) {
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 8) throw new RangeError('1 to 8 signatures');
  const count = entries.length;
  const header = new Uint8Array(2 + 14 * count);
  header[0] = count;
  header[1] = 0;
  const dv = new DataView(header.buffer);
  const data = [];
  let off = header.length;
  entries.forEach(({ publicKey, signature, message }, i) => {
    if (publicKey.length !== 33 || signature.length !== 64) throw new RangeError('33-byte key and 64-byte signature');
    if (!isLowS(signature)) throw new RangeError('signature must be low-S');
    const base = 2 + 14 * i;
    const pk = off;
    const sig = pk + 33;
    const msg = sig + 64;
    dv.setUint16(base + 0, sig, true);
    dv.setUint16(base + 2, 0xffff, true);
    dv.setUint16(base + 4, pk, true);
    dv.setUint16(base + 6, 0xffff, true);
    dv.setUint16(base + 8, msg, true);
    dv.setUint16(base + 10, message.length, true);
    dv.setUint16(base + 12, 0xffff, true);
    data.push(publicKey, signature, message);
    off = msg + message.length;
  });
  if (off > 0xffff) throw new RangeError('instruction data too large');
  return concat(header, ...data);
}
