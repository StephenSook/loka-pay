// One allowance account, read for /watch's meter: cap, settled so far, what is left and the
// serials used, decoded from devnet's getAccountInfo answer with lib/vault.ts decodeAllowance.
// Pure functions: the read itself is made by lib/watch.ts. Nothing here is a typed-in value;
// an answer this page cannot check is refused with the reason, never shown.

import { RpcError, accountData, withContext } from "./solana";
import { decodeAllowance, type Allowance } from "./vault";

/**
 * Serials one allowance can spend: state.rs `used_serials: [u8; 32]` is a 256-bit bitmap and a
 * note's serial is a u8 (docs/FACTS.json serials_per_allowance, checked in unit/watch.test.ts).
 */
export const SERIALS_PER_ALLOWANCE = 256;

export interface AllowanceMeter {
  /** The allowance id, decimal. */
  id: string;
  /** The context slot devnet read the account at. */
  slot: number;
  capUnits: string;
  /** redeem.rs adds each settled note's amount here. */
  settledUnits: string;
  /** cap minus settled; zero if settled were ever above the cap (redeem.rs forbids it). */
  leftUnits: string;
  offlineLimitUnits: string;
  serialsUsed: number;
  /** Unix seconds. */
  expiry: number;
  /** True only if the account says more was settled than the cap allows. */
  overCap: boolean;
}

export type AllowanceRead = { kind: "found"; meter: AllowanceMeter } | { kind: "missing"; slot: number };

/** The meter's numbers from a decoded allowance, read at `slot`. */
export function meterOf(allowance: Allowance, slot: number): AllowanceMeter {
  const zero = BigInt(0);
  const left = allowance.cap - allowance.redeemed;
  return {
    id: allowance.id.toString(),
    slot,
    capUnits: allowance.cap.toString(),
    settledUnits: allowance.redeemed.toString(),
    leftUnits: (left > zero ? left : zero).toString(),
    offlineLimitUnits: allowance.offlineLimit.toString(),
    serialsUsed: allowance.usedSerialCount,
    expiry: Number(allowance.expiry),
    overCap: left < zero,
  };
}

/**
 * getAccountInfo (encoding base64, with context) for an allowance address. The account must be
 * owned by the program and hold the allowance with the id asked for; a missing account is
 * "missing" (never opened, or the wrong id). Throws RpcError on any other answer.
 */
export function readAllowanceAnswer(result: unknown, programId: string, allowanceId: string): AllowanceRead {
  const { slot, value } = withContext(result);
  if (value === null) return { kind: "missing", slot };
  const v = value as { owner?: unknown; data?: unknown } | null;
  if (typeof v !== "object" || v === null || typeof v.owner !== "string") {
    throw new RpcError("shape", "the allowance account answer had no owner");
  }
  if (v.owner !== programId) throw new RpcError("shape", "the account at the allowance address is not owned by the program");
  let allowance: Allowance;
  try {
    allowance = decodeAllowance(accountData(v.data));
  } catch (e) {
    throw new RpcError("shape", `the allowance account could not be decoded: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (allowance.id.toString() !== allowanceId) {
    throw new RpcError("shape", `the account at the allowance address holds allowance ${allowance.id}, not ${allowanceId}`);
  }
  const expiry = Number(allowance.expiry);
  if (!Number.isSafeInteger(expiry)) throw new RpcError("shape", "the allowance names an impossible expiry");
  return { kind: "found", meter: meterOf(allowance, slot) };
}
