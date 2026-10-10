// The settled redeem and the refused cheat (PLAN.md 3.74), on /judge and the home page. Two
// recorded devnet transactions from docs/FACTS.json (lib/proof-pair.ts), each with its explorer
// link. They are facts to check, not current reads, so neither card says Live. Every state is a
// word AND an icon; the refused card takes the Failed style (border-failed-strong), as /verify's
// failure card does.

import { StateChip } from "./chips";
import { CARD, OutLink, When } from "./judge-ui";
import { PROOF_PAIR, PROOF_PAIR_LABEL, type RecordedTx } from "@/lib/proof-pair";

function shortSignature(signature: string): string {
  return `${signature.slice(0, 8)}...${signature.slice(-8)}`;
}

function TxCard({
  tx,
  kind,
  title,
  children,
}: {
  tx: RecordedTx;
  kind: "settled" | "refused";
  title: string;
  children: React.ReactNode;
}) {
  const frame = kind === "refused" ? "min-w-0 rounded-card border-3 border-failed-strong bg-surface p-5 shadow-hard" : CARD;
  return (
    <li className={`${frame} flex flex-col gap-3`} data-testid={`proof-${kind}`} data-signature={tx.signature}>
      {kind === "settled" ? (
        <StateChip state="paid" label="Settled" testId="proof-status" />
      ) : (
        <StateChip state="failed" label="Failed: SerialUsed (6011)" testId="proof-status" />
      )}
      <h3 className="text-xl sm:text-2xl">{title}</h3>
      <p className="leading-relaxed">{children}</p>
      <p className="text-sm font-bold" data-testid="proof-label">
        {PROOF_PAIR_LABEL}
      </p>
      <p className="text-sm text-muted">
        Block time <When ms={tx.blockTimeMs} />. Transaction <span className="break-all font-mono">{shortSignature(tx.signature)}</span>.
      </p>
      <OutLink href={tx.explorer} testId="proof-explorer">
        Check it on Solana Explorer
      </OutLink>
    </li>
  );
}

export function ProofPair() {
  return (
    <section aria-labelledby="proof-pair-title" className="flex min-w-0 flex-col gap-4" data-testid="proof-pair">
      <div className="flex flex-col gap-2">
        <h2 id="proof-pair-title" className="text-3xl">
          Settled, then refused
        </h2>
        <p className="leading-relaxed">
          Two recorded transactions on Solana devnet. These are not current reads: open each one on the explorer to
          check it yourself.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2" aria-label="Recorded devnet transactions">
        <TxCard tx={PROOF_PAIR.settled} kind="settled" title="A payment note settled">
          Solana&apos;s secp256r1 precompile verified the note&apos;s P-256 signature, and the loka_vault program
          credited the merchant.
        </TxCard>
        <TxCard tx={PROOF_PAIR.refused} kind="refused" title="The same note, signed again, was refused">
          The same allowance and serial, signed again for a second merchant. The program refused it on chain with
          SerialUsed, error 6011, and moved no tokens.
        </TxCard>
      </ul>
    </section>
  );
}
