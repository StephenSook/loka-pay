// The settled redeem and the refused cheat (PLAN.md 3.74), on /judge and the home page. The
// iPhone-signed pair leads: a payment signed on an iPhone with its Secure Enclave key and paid
// offline by camera QR, then the same allowance and serial signed again on that iPhone and
// refused. The earlier pair, signed outside the iPhone app with a test key, sits below it behind
// a disclosure, with smaller cards. Every transaction is a recorded devnet transaction from
// docs/FACTS.json (lib/proof-pair.ts) with its explorer link. They are facts to check, not
// current reads, so no card says Live. Every state is a word AND an icon; a refused card takes
// the Failed style (border-failed-strong), as /verify's failure card does.

import { StateChip } from "./chips";
import { CARD, OutLink, When } from "./judge-ui";
import {
  IPHONE_PAIR,
  IPHONE_REFUSED_LABEL,
  IPHONE_SETTLED_LABEL,
  PROOF_PAIR,
  PROOF_PAIR_LABEL,
  type RecordedTx,
} from "@/lib/proof-pair";

function shortHex(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-8)}`;
}

function TxCard({
  tx,
  kind,
  title,
  label,
  compact = false,
  children,
}: {
  tx: RecordedTx;
  kind: "settled" | "refused";
  title: string;
  label: string;
  compact?: boolean;
  children: React.ReactNode;
}) {
  // The earlier pair is smaller: less padding and a smaller title, the same word, icon and color.
  const frame =
    kind === "refused"
      ? `min-w-0 rounded-card border-3 border-failed-strong bg-surface ${compact ? "p-4" : "p-5"} shadow-hard`
      : compact
        ? "min-w-0 rounded-card border-3 border-ink bg-surface p-4 shadow-hard"
        : CARD;
  return (
    <li className={`${frame} flex flex-col gap-3`} data-testid={`proof-${kind}`} data-signature={tx.signature}>
      {kind === "settled" ? (
        <StateChip state="paid" label="Settled" testId="proof-status" />
      ) : (
        <StateChip state="failed" label="Failed: SerialUsed (6011)" testId="proof-status" />
      )}
      <h3 className={compact ? "text-lg" : "text-xl sm:text-2xl"}>{title}</h3>
      <p className={compact ? "text-sm leading-relaxed" : "leading-relaxed"}>{children}</p>
      <p className="text-sm font-bold" data-testid="proof-label">
        {label}
      </p>
      <p className="text-sm text-muted">
        Block time <When ms={tx.blockTimeMs} />. Transaction <span className="break-all font-mono">{shortHex(tx.signature)}</span>.
        {tx.noteId ? (
          <>
            {" "}
            Note id{" "}
            <span className="break-all font-mono" data-testid="proof-note-id" data-note-id={tx.noteId}>
              {shortHex(tx.noteId)}
            </span>
            .
          </>
        ) : null}
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
          Two recorded transactions on Solana devnet, both signed on an iPhone. These are not current reads: open
          each one on the explorer to check it yourself.
        </p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2" aria-label="Signed on an iPhone" data-testid="proof-pair-iphone">
        <TxCard tx={IPHONE_PAIR.settled} kind="settled" title="A payment signed on an iPhone settled" label={IPHONE_SETTLED_LABEL}>
          A teammate&apos;s iPhone signed the note with its Secure Enclave key and showed it as a QR code. The
          merchant iPhone read it with its camera while both phones were offline. When the merchant phone came
          online, Solana&apos;s secp256r1 precompile verified the signature and the loka_vault program credited the
          merchant.
        </TxCard>
        <TxCard
          tx={IPHONE_PAIR.refused}
          kind="refused"
          title="The same note, signed again on that iPhone, was refused"
          label={IPHONE_REFUSED_LABEL}
        >
          The app&apos;s Try to cheat control signed the same allowance and serial again, for a different merchant
          phone. The program refused it on chain with SerialUsed, error 6011, and moved no tokens.
        </TxCard>
      </ul>
      <details className="min-w-0" data-testid="proof-pair-test-key">
        <summary className="cursor-pointer font-bold">Earlier test-key pair, Sat Oct 10 2:01 AM ET</summary>
        <p className="mt-3 text-sm leading-relaxed">
          The same check, run before the phones were ready, with a note signed outside the iPhone app with a test key.
        </p>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2" aria-label="Signed with a test key">
          <TxCard tx={PROOF_PAIR.settled} kind="settled" title="A test-key note settled" label={PROOF_PAIR_LABEL} compact>
            Solana&apos;s secp256r1 precompile verified the note&apos;s P-256 signature, and the loka_vault program
            credited the merchant.
          </TxCard>
          <TxCard
            tx={PROOF_PAIR.refused}
            kind="refused"
            title="The same note, signed again, was refused"
            label={PROOF_PAIR_LABEL}
            compact
          >
            The same allowance and serial, signed again for a second merchant. The program refused it on chain with
            SerialUsed, error 6011, and moved no tokens.
          </TxCard>
        </ul>
      </details>
    </section>
  );
}
