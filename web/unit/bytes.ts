// Test-only helpers for building account and log bytes by hand, field by field, in the
// layouts of programs/loka_vault/src/state.rs (Anchor borsh, little-endian integers).

import { createHash } from "node:crypto";
import { decodeBase58 } from "../lib/base58";

export function le64(value: bigint | number): Uint8Array {
  let n = BigInt(value);
  if (n < BigInt(0)) n += BigInt(1) << BigInt(64);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) {
    out[i] = Number(n & BigInt(0xff));
    n >>= BigInt(8);
  }
  return out;
}

export function le32(value: number): Uint8Array {
  return Uint8Array.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);
}

export function concat(...parts: Array<Uint8Array | number[]>): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function filled(length: number, byte: number): Uint8Array {
  return new Uint8Array(length).fill(byte);
}

export function pubkey(base58: string): Uint8Array {
  return decodeBase58(base58);
}

export function sha256Prefix(text: string): number[] {
  return [...createHash("sha256").update(text).digest().subarray(0, 8)];
}

export function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function fromBase64(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, "base64"));
}

/** Pads to an account's allocated size, as Anchor allocates `8 + INIT_SPACE` and leaves the rest zero. */
export function padTo(bytes: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  out.set(bytes);
  return out;
}
