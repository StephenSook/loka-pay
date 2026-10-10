// Labels for the /live rows docs/FACTS.json records (PLAN.md 3.84): the two iPhone runs and the
// earlier test-key pair, read from FACTS at build time through lib/proof-pair.ts. Built on the
// server (app/live/page.tsx) and passed to the feed as a small map, so the browser never loads
// FACTS itself. A row with no entry carries no label: nothing is guessed about who signed it.

import raw from "../../docs/FACTS.json";
import {
  IPHONE_PAIR,
  IPHONE_REFUSED_LABEL,
  IPHONE_RUN2,
  IPHONE_SETTLED_LABEL,
  PROOF_PAIR,
  PROOF_PAIR_LABEL,
} from "./proof-pair";

export interface RowLabel {
  /** The chip: "iPhone payment", "iPhone cheat" or "Test key". */
  chip: string;
  /** The sentence that transaction's FACTS caveat says. */
  detail: string;
}

const facts = (raw as { facts: Record<string, { caveat?: unknown } | undefined> }).facts;

/** A FACTS entry's caveat, or a throw naming the key: a label never shows a sentence FACTS does not have. */
function caveatOf(key: string): string {
  const caveat = facts[key]?.caveat;
  if (typeof caveat !== "string" || caveat.length === 0) throw new Error(`docs/FACTS.json facts.${key} has no caveat to label /live with`);
  return caveat;
}

export function rowLabels(): Record<string, RowLabel> {
  return {
    [IPHONE_PAIR.settled.signature]: { chip: "iPhone payment", detail: IPHONE_SETTLED_LABEL },
    [IPHONE_PAIR.refused.signature]: { chip: "iPhone cheat", detail: IPHONE_REFUSED_LABEL },
    [IPHONE_RUN2.settled.signature]: { chip: "iPhone payment", detail: caveatOf("proof_pair_iphone_run2_settled_tx") },
    [IPHONE_RUN2.refused.signature]: { chip: "iPhone cheat", detail: caveatOf("proof_pair_iphone_run2_refused_tx") },
    [PROOF_PAIR.settled.signature]: { chip: "Test key", detail: PROOF_PAIR_LABEL },
    [PROOF_PAIR.refused.signature]: { chip: "Test key", detail: PROOF_PAIR_LABEL },
  };
}
