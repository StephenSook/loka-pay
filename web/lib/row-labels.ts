// Labels for the /live rows docs/FACTS.json records (PLAN.md 3.84): the iPhone proof pair and the
// earlier test-key pair, both read from FACTS at build time by lib/proof-pair.ts. Built on the
// server (app/live/page.tsx) and passed to the feed as a small map, so the browser never loads
// FACTS itself. A row with no entry carries no label: nothing is guessed about who signed it.

import { IPHONE_PAIR, IPHONE_REFUSED_LABEL, IPHONE_SETTLED_LABEL, PROOF_PAIR, PROOF_PAIR_LABEL } from "./proof-pair";

export interface RowLabel {
  /** The chip: "iPhone payment", "iPhone cheat" or "Test key". */
  chip: string;
  /** The sentence that transaction's FACTS caveat says (lib/proof-pair.ts). */
  detail: string;
}

export function rowLabels(): Record<string, RowLabel> {
  return {
    [IPHONE_PAIR.settled.signature]: { chip: "iPhone payment", detail: IPHONE_SETTLED_LABEL },
    [IPHONE_PAIR.refused.signature]: { chip: "iPhone cheat", detail: IPHONE_REFUSED_LABEL },
    [PROOF_PAIR.settled.signature]: { chip: "Test key", detail: PROOF_PAIR_LABEL },
    [PROOF_PAIR.refused.signature]: { chip: "Test key", detail: PROOF_PAIR_LABEL },
  };
}
