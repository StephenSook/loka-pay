// Base58 (the Bitcoin alphabet Solana uses for addresses and transaction signatures).
// Small enough to keep here instead of adding a package. lib/test-vector.ts checks both
// directions against the published vectors at build time, so a bug fails `next build`.

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE = BigInt(58);
const BYTE = BigInt(256);
const ZERO = BigInt(0);

export function encodeBase58(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros += 1;
  let n = ZERO;
  for (const b of bytes) n = n * BYTE + BigInt(b);
  let out = "";
  while (n > ZERO) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  return "1".repeat(zeros) + out;
}

/** Throws on any character outside the alphabet. */
export function decodeBase58(text: string): Uint8Array {
  if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(text)) throw new Error("not base58");
  let zeros = 0;
  while (zeros < text.length && text[zeros] === "1") zeros += 1;
  let n = ZERO;
  for (const c of text) n = n * BASE + BigInt(ALPHABET.indexOf(c));
  const tail: number[] = [];
  while (n > ZERO) {
    tail.unshift(Number(n % BYTE));
    n /= BYTE;
  }
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...tail]);
}
