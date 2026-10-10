// The proof pair on /judge and the home page (PLAN.md 3.74): the settled redeem and the refused
// cheat recorded on devnet at 2:01 AM ET on Sat Oct 10. Both signatures come from
// docs/FACTS.json (proof_pair_settled_tx, proof_pair_refused_tx), a static import bundled at
// build time like config/pins.json in lib/pins.ts: an entry that is missing, not measured, or
// not a 64-byte base58 signature throws here, and the build fails instead of a page showing it.
//
// These are recorded facts, not reads: the pages never call them Live. Each links the explorer
// so a judge can check it on devnet.

import raw from "../../docs/FACTS.json";
import { decodeBase58 } from "./base58";
import { explorerTx } from "./solana";

export const FACTS_FILE = "docs/FACTS.json";

/** How the pair was signed, said on both cards (the FACTS caveats say the same). */
export const PROOF_PAIR_LABEL = "Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.";

export interface RecordedTx {
  /** The FACTS key the signature comes from. */
  key: string;
  signature: string;
  explorer: string;
  /** The block time, from the entry's as_of. */
  blockTimeMs: number;
}

/** One FACTS entry as a recorded transaction, or a throw that names the key and what is wrong. */
export function recordedTx(key: string, entry: unknown): RecordedTx {
  const e = entry as { value?: unknown; status?: unknown; as_of?: unknown } | null | undefined;
  const fail = (why: string): never => {
    throw new Error(`${FACTS_FILE} facts.${key} ${why}`);
  };
  if (!e || typeof e !== "object") return fail("is missing");
  if (e.status !== "measured") fail(`has status ${JSON.stringify(e.status)}, not "measured"`);
  if (typeof e.value !== "string") return fail("has no signature value");
  let bytes: Uint8Array;
  try {
    bytes = decodeBase58(e.value);
  } catch {
    return fail("is not base58");
  }
  if (bytes.length !== 64) fail(`decodes to ${bytes.length} bytes, not a 64-byte transaction signature`);
  const blockTimeMs = typeof e.as_of === "string" ? Date.parse(e.as_of) : NaN;
  if (Number.isNaN(blockTimeMs)) fail("has no as_of time");
  return { key, signature: e.value, explorer: explorerTx(e.value), blockTimeMs };
}

const facts = (raw as { facts: Record<string, unknown> }).facts;

export const PROOF_PAIR = {
  settled: recordedTx("proof_pair_settled_tx", facts.proof_pair_settled_tx),
  refused: recordedTx("proof_pair_refused_tx", facts.proof_pair_refused_tx),
} as const;
