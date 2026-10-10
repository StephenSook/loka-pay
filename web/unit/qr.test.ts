import { expect, test } from "@playwright/test";
import jsQR from "jsqr";
import { TEST_EARMARKS, testAllowanceWire } from "../e2e/fixtures/remittance";
import { QUIET_ZONE, qrMatrix, qrPath, type QrMatrix } from "../lib/qr";
import { allowanceCode } from "../lib/remittance";

// /send's QR code (lib/qr.ts) decoded by an independent decoder, jsQR, from pixels drawn the way
// components/qr-code.tsx draws them: black modules on white with a four-module quiet zone.

const SCALE = 4;

/** RGBA pixels of the code, SCALE pixels per module, with the quiet zone. */
function pixels(m: QrMatrix): { data: Uint8ClampedArray; side: number } {
  const modules = m.size + 2 * QUIET_ZONE;
  const side = modules * SCALE;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let y = 0; y < m.size; y += 1) {
    for (let x = 0; x < m.size; x += 1) {
      if (!m.dark[y][x]) continue;
      for (let dy = 0; dy < SCALE; dy += 1) {
        for (let dx = 0; dx < SCALE; dx += 1) {
          const at = (((y + QUIET_ZONE) * SCALE + dy) * side + (x + QUIET_ZONE) * SCALE + dx) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    }
  }
  return { data, side };
}

test("an allowance code with no, two and sixteen earmarks decodes back to the same text", () => {
  const sixteen = Array.from({ length: 16 }, (_, i) => (i + 1).toString(16).padStart(2, "0").repeat(32)).sort();
  for (const earmarks of [[], TEST_EARMARKS, sixteen]) {
    const text = allowanceCode(testAllowanceWire({ allowanceId: BigInt("18446744073709551615"), cap: BigInt(1_000_000), earmarks }));
    const m = qrMatrix(text);
    const { data, side } = pixels(m);
    const decoded = jsQR(data, side, side, { inversionAttempts: "dontInvert" });
    expect(decoded, `${earmarks.length} earmarks`).not.toBeNull();
    expect(decoded!.data).toBe(text);
  }
});

test("the drawing has one path square per dark module, inside the quiet zone", () => {
  const m = qrMatrix("L1|P|1|A|AAAA");
  const dark = m.dark.flat().filter(Boolean).length;
  const d = qrPath(m, QUIET_ZONE);
  expect(d.match(/M/g)?.length).toBe(dark);
  const xs = [...d.matchAll(/M(\d+) (\d+)/g)].flatMap((g) => [Number(g[1]), Number(g[2])]);
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(QUIET_ZONE);
  expect(Math.max(...xs)).toBeLessThan(QUIET_ZONE + m.size);
});
