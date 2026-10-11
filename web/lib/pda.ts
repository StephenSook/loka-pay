// Program derived addresses, as Solana's `Pubkey::find_program_address` computes them, so a
// page can find a program account from its seeds alone, with no getProgramAccounts scan
// (public devnet allows 10 of those per 10 s per IP). /watch uses it to read an allowance
// from its id: open.rs creates each allowance at seeds ["allowance", id as 8 bytes big-endian].
//
// An address is sha256(seeds || bump || program id || "ProgramDerivedAddress") for the
// highest bump from 255 down whose hash is NOT a point on the ed25519 curve (so no private
// key exists for it). The curve check follows curve25519-dalek's CompressedEdwardsY::decompress,
// which Solana's `is_on_curve` calls: the top bit is the sign and is ignored, y is taken modulo
// p, and the point exists when (y^2 - 1) / (d y^2 + 1) has a square root modulo p.
// unit/pda.test.ts checks the result against the config, vault and allowance accounts the
// program created on devnet (config/pins.json and a recorded getProgramAccounts answer).
//
// SHA-256 comes from the browser's Web Crypto (crypto.subtle), which browsers offer on https
// pages and on localhost. No package.

import { decodeBase58, encodeBase58 } from "./base58";

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TWO = BigInt(2);
/** The field prime of curve25519, 2^255 - 19. */
const P = (ONE << BigInt(255)) - BigInt(19);

function mod(a: bigint): bigint {
  const r = a % P;
  return r < ZERO ? r + P : r;
}

function powMod(base: bigint, exponent: bigint): bigint {
  let result = ONE;
  let b = mod(base);
  let e = exponent;
  while (e > ZERO) {
    if ((e & ONE) === ONE) result = (result * b) % P;
    b = (b * b) % P;
    e >>= ONE;
  }
  return result;
}

const inverse = (a: bigint) => powMod(a, P - TWO);

/** The ed25519 curve constant d = -121665 / 121666 modulo p. */
const D = mod(-BigInt(121665) * inverse(BigInt(121666)));

/** Whether 32 bytes decode to a point on the ed25519 curve (curve25519-dalek's decompress succeeds). */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) throw new Error(`a curve point is 32 bytes, not ${bytes.length}`);
  let y = ZERO;
  for (let i = 31; i >= 0; i -= 1) y = (y << BigInt(8)) | BigInt(bytes[i]);
  // The top bit is the sign of x; dalek ignores it here and reduces y modulo p.
  y = mod(y & ((ONE << BigInt(255)) - ONE));
  const y2 = (y * y) % P;
  const u = mod(y2 - ONE);
  const v = mod(D * y2 + ONE);
  // dalek's sqrt_ratio_i: a zero u is a valid point (x = 0); a zero v with a nonzero u is not.
  if (u === ZERO) return true;
  if (v === ZERO) return false;
  // Euler's criterion: u / v is a square modulo p exactly when its (p - 1) / 2 power is 1.
  const ratio = (u * inverse(v)) % P;
  return powMod(ratio, (P - ONE) / TWO) === ONE;
}

const MARKER = new TextEncoder().encode("ProgramDerivedAddress");
const MAX_SEEDS = 16;
const MAX_SEED_LEN = 32;

async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("this browser offers no SHA-256 here (Web Crypto needs an https page)");
  return new Uint8Array(await subtle.digest("SHA-256", data));
}

export interface ProgramAddress {
  address: string;
  bump: number;
}

/** Solana's find_program_address: the address for `seeds` under `programId`, and its bump. */
export async function findProgramAddress(seeds: readonly Uint8Array[], programId: string): Promise<ProgramAddress> {
  if (seeds.length > MAX_SEEDS - 1) throw new Error(`at most ${MAX_SEEDS - 1} seeds before the bump`);
  for (const seed of seeds) {
    if (seed.length > MAX_SEED_LEN) throw new Error(`a seed is at most ${MAX_SEED_LEN} bytes`);
  }
  const program = decodeBase58(programId);
  if (program.length !== 32) throw new Error("a program id is 32 bytes");
  const seedBytes = seeds.reduce((n, s) => n + s.length, 0);
  const input = new Uint8Array(seedBytes + 1 + 32 + MARKER.length);
  let at = 0;
  for (const seed of seeds) {
    input.set(seed, at);
    at += seed.length;
  }
  const bumpAt = at;
  input.set(program, bumpAt + 1);
  input.set(MARKER, bumpAt + 1 + 32);
  for (let bump = 255; bump >= 0; bump -= 1) {
    input[bumpAt] = bump;
    const hash = await sha256(input);
    if (!isOnCurve(hash)) return { address: encodeBase58(hash), bump };
  }
  throw new Error("no bump gives an address off the curve");
}

/** A u64 as 8 bytes, big-endian, as open.rs uses the allowance id in its seeds (`to_be_bytes`). */
export function u64BigEndian(value: bigint): Uint8Array {
  if (value < ZERO || value >= ONE << BigInt(64)) throw new Error("not a u64");
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i -= 1) {
    out[i] = Number(v & BigInt(0xff));
    v >>= BigInt(8);
  }
  return out;
}

/** programs/loka_vault/src/constants.rs ALLOWANCE_SEED. */
export const ALLOWANCE_SEED = new TextEncoder().encode("allowance");

/** The allowance account's address for an allowance id (open.rs: seeds = [ALLOWANCE_SEED, id.to_be_bytes()]). */
export async function allowanceAddress(allowanceId: bigint, programId: string): Promise<string> {
  return (await findProgramAddress([ALLOWANCE_SEED, u64BigEndian(allowanceId)], programId)).address;
}
