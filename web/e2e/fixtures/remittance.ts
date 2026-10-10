// TEST FIXTURE for /send (PLAN.md 3.3): allowance certificates and POST /v1/remittances
// answers in the shapes of server/src/remit/remittance.ts on feat/phase3-measure (API-V1
// section 9). Certificates are signed with the published test vector server key
// (e2e/fixtures/ports.ts), never with a real key, under the pinned devnet deployment.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { base64urlEncode, encodeEarmarks, fromHex, signAllowWire, type Deployment } from "@lokapay/protocol";
import { decodeBase58, encodeBase58 } from "../../lib/base58";
import { E2E_SERVER_KEY_LABEL } from "./ports";

const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pins = JSON.parse(readFileSync(path.join(repoRoot, "config", "pins.json"), "utf8"));

/** The pinned devnet deployment, decoded here from config/pins.json rather than through the app. */
export const PINNED: Deployment = { programId: decodeBase58(pins.programId), clusterId: 0, mint: decodeBase58(pins.mint) };

/** The published test vector server seed: sha256 of its label (protocol/vectors/payment-v1.json keys.derivation). */
export const TEST_SERVER_SEED = new Uint8Array(createHash("sha256").update(E2E_SERVER_KEY_LABEL).digest());

/** A fixed payer key hash for the fixtures: sha256("e2e payer"). Not a real phone. */
export const TEST_PAYER_KEY_HASH = new Uint8Array(createHash("sha256").update("e2e payer").digest());

/** Two fixed merchant key hashes, sorted, for an earmarked certificate. */
export const TEST_EARMARKS = ["e2e merchant a", "e2e merchant b"]
  .map((label) => createHash("sha256").update(label).digest("hex"))
  .sort();

/** TEST FIXTURE: base58 of 64 bytes of 0x11, the shape of a transaction signature, not a real transaction. */
export const TEST_TX = encodeBase58(new Uint8Array(64).fill(0x11));
/** Another signature shape (64 bytes of 0x22), for the failed-transaction answer. */
export const TEST_FAILED_TX = encodeBase58(new Uint8Array(64).fill(0x22));

export interface CertificateOptions {
  allowanceId: bigint;
  cap: bigint;
  earmarks?: string[];
  expiry?: bigint;
  deployment?: Deployment;
  seed?: Uint8Array;
}

/** The allowance wire (PAYMENT-V1 section 4.5), signed with the test seed unless another is given. */
export function testAllowanceWire(o: CertificateOptions): Uint8Array {
  return signAllowWire(
    o.deployment ?? PINNED,
    {
      allowanceId: o.allowanceId,
      payerKeyHash: TEST_PAYER_KEY_HASH,
      cap: o.cap,
      offlineLimit: o.cap,
      expiry: o.expiry ?? BigInt(1_792_000_000),
      earmarkList: encodeEarmarks((o.earmarks ?? []).map(fromHex)),
      bond: BigInt(0),
    },
    o.seed ?? TEST_SERVER_SEED,
  );
}

/** A 201 (or 200 repeat) body as the server sends it. */
export function successBody(recipientAllowanceId: string, o: CertificateOptions, signature = TEST_TX) {
  return {
    recipientAllowanceId,
    allowanceId: o.allowanceId.toString(),
    allow: base64urlEncode(testAllowanceWire(o)),
    earmarks: o.earmarks ?? [],
    signature,
    explorer: `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
    sandbox: true,
  };
}

/** A 202 body. */
export function pendingBody(recipientAllowanceId: string, signature: string | null = null, retryAfter = 2) {
  return { status: "pending", recipientAllowanceId, signature, retryAfter };
}
