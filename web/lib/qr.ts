// A QR code as a grid of dark and light modules, for /send's allowance code. Encoded in the
// browser with uqr (no request, no canvas) at error correction level M, the level the iPhone
// app uses for its own payment codes (ios/LokaPay/Sources/LokaPay/UI/PaymentQR.swift).
// unit/qr.test.ts decodes the grid with an independent decoder (jsQR) and compares the text.

import { encode } from "uqr";

export interface QrMatrix {
  /** Modules per side, without the quiet zone. */
  size: number;
  /** dark[y][x]: true for a dark module. */
  dark: boolean[][];
}

/** The modules of `text` as a QR code at level M, with no border (the drawing adds the quiet zone). */
export function qrMatrix(text: string): QrMatrix {
  const result = encode(text, { ecc: "M", border: 0 });
  return { size: result.size, dark: result.data };
}

/**
 * One SVG path for every dark module, in module units: "M{x} {y}h1v1h-1z" per module, so the
 * drawing is a single element however large the code is.
 */
export function qrPath(matrix: QrMatrix, quiet: number): string {
  let d = "";
  for (let y = 0; y < matrix.size; y += 1) {
    for (let x = 0; x < matrix.size; x += 1) {
      if (matrix.dark[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`;
    }
  }
  return d;
}

/** The quiet zone the QR standard asks for: four modules on every side. */
export const QUIET_ZONE = 4;
