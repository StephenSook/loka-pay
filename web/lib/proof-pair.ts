// The proof pairs on /judge and the home page (PLAN.md 3.74). Each is a settled redeem and a
// refused cheat recorded on devnet:
//   - IPHONE_PAIR leads: signed on an iPhone with its Secure Enclave key and paid offline by
//     camera QR, Sat Oct 10 4:23 PM ET, then the same allowance and serial signed again on that
//     iPhone and refused at 4:31 PM ET (proof_pair_iphone_* in docs/FACTS.json);
//   - PROOF_PAIR is the earlier pair, signed outside the iPhone app with a test key at 2:01 AM ET
//     (proof_pair_settled_tx, proof_pair_refused_tx).
// IPHONE_RUN2, the second iPhone run (5:05 PM settled, 5:09 PM refused), is linked from the home
// page's status card (proof_pair_iphone_run2_*).
// Every value comes from docs/FACTS.json, a static import bundled at build time like
// config/pins.json in lib/pins.ts: an entry that is missing, not measured, or not a 64-byte
// base58 signature (or a 32-byte hex note id) throws here, and the build fails instead of a page
// showing it.
//
// These are recorded facts, not reads: the pages never call them Live. Each links the explorer
// so a judge can check it on devnet.

import raw from "../../docs/FACTS.json";
import { decodeBase58 } from "./base58";
import { explorerTx } from "./solana";

export const FACTS_FILE = "docs/FACTS.json";

/** How the earlier test-key pair was signed, said on both of its cards (its FACTS caveats say the same). */
export const PROOF_PAIR_LABEL = "Signed outside the iPhone app with a test key, Sat Oct 10 2:01 AM ET.";

/** The labels on the iPhone-signed pair, which leads (its FACTS caveats say the same). */
export const IPHONE_SETTLED_LABEL = "Signed on an iPhone (Secure Enclave key), paid offline by camera QR, Sat Oct 10 4:23 PM ET";
export const IPHONE_REFUSED_LABEL =
  "Same allowance and serial signed again on that iPhone, refused by Solana: SerialUsed (6011), Sat Oct 10 4:31 PM ET";

export interface RecordedTx {
  /** The FACTS key the signature comes from. */
  key: string;
  signature: string;
  explorer: string;
  /** The block time, from the entry's as_of. */
  blockTimeMs: number;
  /** The note id (sha256 of the 141-byte note), when FACTS records one for this transaction. */
  noteId?: string;
}

/** One FACTS entry as a recorded note id (64 lowercase hex characters), or a throw naming the key. */
export function recordedNoteId(key: string, entry: unknown): string {
  const e = entry as { value?: unknown; status?: unknown } | null | undefined;
  const fail = (why: string): never => {
    throw new Error(`${FACTS_FILE} facts.${key} ${why}`);
  };
  if (!e || typeof e !== "object") return fail("is missing");
  if (e.status !== "measured") fail(`has status ${JSON.stringify(e.status)}, not "measured"`);
  if (typeof e.value !== "string" || !/^[0-9a-f]{64}$/.test(e.value)) return fail("is not a 32-byte hex note id");
  return e.value;
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

/** The iPhone-signed pair: it leads on both pages. */
export const IPHONE_PAIR = {
  settled: {
    ...recordedTx("proof_pair_iphone_settled_tx", facts.proof_pair_iphone_settled_tx),
    noteId: recordedNoteId("proof_pair_iphone_settled_note_id", facts.proof_pair_iphone_settled_note_id),
  },
  refused: {
    ...recordedTx("proof_pair_iphone_refused_tx", facts.proof_pair_iphone_refused_tx),
    noteId: recordedNoteId("proof_pair_iphone_refused_note_id", facts.proof_pair_iphone_refused_note_id),
  },
} as const;

/**
 * The second iPhone run, Sat Oct 10 5:05 PM ET (settled) and 5:09 PM ET (refused), also paid by
 * camera QR (proof_pair_iphone_run2_* in docs/FACTS.json). The home page's status links it beside
 * the first run.
 */
export const IPHONE_RUN2 = {
  settled: recordedTx("proof_pair_iphone_run2_settled_tx", facts.proof_pair_iphone_run2_settled_tx),
  refused: recordedTx("proof_pair_iphone_run2_refused_tx", facts.proof_pair_iphone_run2_refused_tx),
} as const;

/** The earlier pair, signed outside the iPhone app with a test key: shown below the iPhone pair. */
export const PROOF_PAIR = {
  settled: recordedTx("proof_pair_settled_tx", facts.proof_pair_settled_tx),
  refused: recordedTx("proof_pair_refused_tx", facts.proof_pair_refused_tx),
} as const;
