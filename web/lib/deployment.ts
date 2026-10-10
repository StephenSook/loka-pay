// The pinned devnet deployment for /verify, read from config/pins.json at build time.
// Server only (it reads the file system); the page passes the result to the browser.
//
// Until config/pins.json exists, or while its "serverEd25519PublicKey" is still null (the
// server key comes with task 1.0), this exports null and /verify says the settlement
// server's key is not published. Nothing here invents a key or a program id.
//
// Fields this page reads (other fields in the file are ignored):
//   "cluster":                "devnet"
//   "programId":              base58, 32 bytes
//   "mint":                   base58, 32 bytes
//   "serverEd25519PublicKey": 64 hex characters, or base58 of 32 bytes
//
// A pins file that is present but unreadable fails the build. Falling back to null would
// make the page say "not published" about a key that is.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fromHex, toHex } from "@lokapay/protocol";
import { decodeBase58 } from "./base58";
import type { SerializedDeployment } from "./receipt";

export const PINS_FILE = "config/pins.json";

// `next build` runs in web/, so the repository root is one level up.
const pinsPath = path.join(process.cwd(), "..", "config", "pins.json");

const EXPECTED =
  '{"cluster": "devnet", "programId": "<base58>", "mint": "<base58>", "serverEd25519PublicKey": "<64 hex characters or base58>"}';

function unreadable(reason: string): never {
  throw new Error(`${PINS_FILE} is present but /verify cannot read it: ${reason}. Expected at least ${EXPECTED}.`);
}

function base58Key(fields: Record<string, unknown>, name: string): { hex: string; base58: string } {
  const value = fields[name];
  if (typeof value !== "string") unreadable(`"${name}" must be a base58 string`);
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    unreadable(`"${name}" is not base58`);
  }
  if (bytes.length !== 32) unreadable(`"${name}" must decode to 32 bytes, not ${bytes.length}`);
  return { hex: toHex(bytes), base58: value };
}

function ed25519Key(fields: Record<string, unknown>, name: string): string {
  const value = fields[name];
  if (typeof value !== "string") unreadable(`"${name}" must be a string`);
  if (/^[0-9a-fA-F]{64}$/.test(value)) return toHex(fromHex(value));
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(value);
  } catch {
    unreadable(`"${name}" is neither 64 hex characters nor base58`);
  }
  if (bytes.length !== 32) unreadable(`"${name}" must be 32 bytes, not ${bytes.length}`);
  return toHex(bytes);
}

function readPins(): SerializedDeployment | null {
  if (!existsSync(pinsPath)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(pinsPath, "utf8"));
  } catch (e) {
    unreadable(`not valid JSON (${e instanceof Error ? e.message : String(e)})`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) unreadable("the top level must be an object");
  const fields = parsed as Record<string, unknown>;
  // This page links to the devnet explorer and says "sandbox"; it checks devnet only.
  if (fields.cluster !== "devnet") unreadable('"cluster" must be "devnet"');
  const programId = base58Key(fields, "programId");
  const mint = base58Key(fields, "mint");
  // The server key arrives with task 1.0, after the program and wallets are pinned. Until
  // then the file carries null, and confirmations cannot be checked: say so, as with no file.
  if (fields.serverEd25519PublicKey === null) return null;
  return {
    clusterId: 0,
    programIdHex: programId.hex,
    programIdBase58: programId.base58,
    mintHex: mint.hex,
    mintBase58: mint.base58,
    serverPublicKeyHex: ed25519Key(fields, "serverEd25519PublicKey"),
  };
}

/** The pinned devnet deployment, or null when config/pins.json is absent or its server key is still null. */
export const pinnedDeployment: SerializedDeployment | null = readPins();
