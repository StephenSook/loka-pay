export interface RedeemRow {
  signature: string; slot: number; feeLamports: number; computeUnits: number;
  error: unknown; source: 'measurement' | 'load_test';
}
export interface RedeemLimits { units: number; loadedBytes: number }
export function limitsFromSimulation(units: number | undefined, bytes: number | undefined): RedeemLimits {
  if (!Number.isSafeInteger(units) || units! <= 0 || !Number.isSafeInteger(bytes) || bytes! < 0) throw new Error('Simulation did not report compute units and loaded data size');
  const limits = { units: Math.ceil(units! * 11 / 10), loadedBytes: (Math.floor(bytes! / 32768) + 1) * 32768 };
  if (limits.units > 1400000 || limits.loadedBytes > 64 * 1024 * 1024) throw new Error('Measured limits exceed transaction limits');
  return limits;
}
export function summarizeRows(rows: RedeemRow[]) {
  const signatures = new Set<string>();
  for (const row of rows) {
    if (!row.signature || !Number.isSafeInteger(row.slot) || row.slot < 0 || !Number.isSafeInteger(row.feeLamports) || row.feeLamports < 0
      || !Number.isSafeInteger(row.computeUnits) || row.computeUnits < 0 || row.error === undefined
      || !['measurement', 'load_test'].includes(row.source) || signatures.has(row.signature)) throw new Error('Invalid measured transaction');
    signatures.add(row.signature);
  }
  const headline = rows.filter(row => row.source === 'measurement' && row.error === null);
  const units = headline.map(row => row.computeUnits).sort((a, b) => a - b), mid = Math.floor(units.length / 2);
  return { payments: headline.length, totalFeeLamports: headline.reduce((sum, row) => sum + BigInt(row.feeLamports), 0n).toString(),
    medianComputeUnits: units.length ? (units.length % 2 ? units[mid] : (units[mid - 1] + units[mid]) / 2) : null };
}
