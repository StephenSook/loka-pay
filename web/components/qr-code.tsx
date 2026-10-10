// A QR code drawn as one SVG path, black on white in both color schemes (a scanner needs dark
// modules on a light ground). No hooks, so server and client pages both use it.

import { QUIET_ZONE, qrMatrix, qrPath } from "@/lib/qr";

export function QrCode({ text, label, testId }: { text: string; label: string; testId?: string }) {
  const matrix = qrMatrix(text);
  const side = matrix.size + 2 * QUIET_ZONE;
  return (
    <svg
      role="img"
      aria-label={label}
      data-testid={testId}
      data-text={text}
      data-modules={matrix.size}
      viewBox={`0 0 ${side} ${side}`}
      shapeRendering="crispEdges"
      className="block aspect-square w-full max-w-[22rem] rounded-xl border-3 border-ink"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={qrPath(matrix, QUIET_ZONE)} fill="#000000" />
    </svg>
  );
}
