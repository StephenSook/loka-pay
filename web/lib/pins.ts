// Every public field of config/pins.json, for the pages that read the chain (/judge, /live,
// /proof, /trust). The file is a static JSON import, so it is bundled at build time like
// the vectors file in lib/test-vector.ts: a missing or malformed file fails the build.
//
// lib/deployment.ts stays as it is: /verify needs the server key and treats a null key as
// "not published". This module needs no server key, so it never returns null. A field that
// is present but not what it claims to be (an address that is not 32 bytes of base58, a
// cluster other than devnet) throws here, and the build fails instead of a page showing it.

import raw from "../../config/pins.json";
import { decodeBase58 } from "./base58";

export const PINS_FILE = "config/pins.json";

export interface Pins {
  cluster: "devnet";
  programId: string;
  mint: string;
  upgradeAuthority: string;
  /** 64 hex characters or base58, or null until the server key exists (task 1.0). */
  serverEd25519PublicKey: string | null;
  /** Null until the settlement node exists. Its format is not fixed yet, so it is only checked to be a string. */
  settlementNodeFingerprint: string | null;
  accounts: { config: string; vault: string; vaultUsdcAccount: string };
  /** Named fee payer addresses (demo, public). */
  feePayers: Record<string, string>;
  /** Named wallet addresses (tableDemo, publicOnboarding, send, canary). */
  wallets: Record<string, string>;
}

export class PinsError extends Error {
  constructor(reason: string) {
    super(`${PINS_FILE} cannot be read by the web pages: ${reason}`);
    this.name = "PinsError";
  }
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new PinsError(`"${name}" must be an object`);
  }
  return value as Record<string, unknown>;
}

/** A Solana address: base58 that decodes to exactly 32 bytes. */
function address(fields: Record<string, unknown>, key: string, name = key): string {
  const value = fields[key];
  if (typeof value !== "string") throw new PinsError(`"${name}" must be a base58 string`);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    throw new PinsError(`"${name}" is not base58`);
  }
  if (bytes.length !== 32) throw new PinsError(`"${name}" must decode to 32 bytes, not ${bytes.length}`);
  return value;
}

function addressMap(value: unknown, name: string): Record<string, string> {
  const fields = asObject(value, name);
  const out: Record<string, string> = {};
  for (const key of Object.keys(fields)) out[key] = address(fields, key, `${name}.${key}`);
  return out;
}

function serverKey(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new PinsError('"serverEd25519PublicKey" must be a string or null');
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value;
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    throw new PinsError('"serverEd25519PublicKey" is neither 64 hex characters nor base58');
  }
  if (bytes.length !== 32) throw new PinsError(`"serverEd25519PublicKey" must be 32 bytes, not ${bytes.length}`);
  return value;
}

/** Checks a parsed pins file and returns its public fields. Throws PinsError naming the first bad field. */
export function parsePins(value: unknown): Pins {
  const fields = asObject(value, "the top level");
  // Every page that reads the chain links to the devnet explorer and says "sandbox".
  if (fields.cluster !== "devnet") throw new PinsError('"cluster" must be "devnet"');
  const fingerprint = fields.settlementNodeFingerprint;
  if (fingerprint !== null && (typeof fingerprint !== "string" || fingerprint.length === 0)) {
    throw new PinsError('"settlementNodeFingerprint" must be a non-empty string or null');
  }
  const accounts = asObject(fields.accounts, "accounts");
  return {
    cluster: "devnet",
    programId: address(fields, "programId"),
    mint: address(fields, "mint"),
    upgradeAuthority: address(fields, "upgradeAuthority"),
    serverEd25519PublicKey: serverKey(fields.serverEd25519PublicKey),
    settlementNodeFingerprint: fingerprint as string | null,
    accounts: {
      config: address(accounts, "config", "accounts.config"),
      vault: address(accounts, "vault", "accounts.vault"),
      vaultUsdcAccount: address(accounts, "vaultUsdcAccount", "accounts.vaultUsdcAccount"),
    },
    feePayers: addressMap(fields.feePayers, "feePayers"),
    wallets: addressMap(fields.wallets, "wallets"),
  };
}

/** The pinned devnet deployment. Evaluated when the module loads, so a bad file fails the build. */
export const PINS: Pins = parsePins(raw);
