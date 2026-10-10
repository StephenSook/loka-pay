"use client";

// "Play the attacker" (PLAN.md 3.52, the browser part). Shown under a receipt that
// verified: the visitor edits the note's amount or payee, the page re-encodes the 141 note
// bytes and runs the same check again (lib/attacker.ts). Nothing is sent and nothing is
// stored; e2e/verify-attacker.spec.ts fails if editing makes any request.

import { useId, useMemo, useState, type FormEvent } from "react";
import { decodeNote, displayAmount, fromHex, toHex } from "@lokapay/protocol";
import {
  NOTE_LENGTH,
  U64_MAX,
  changedCount,
  describeFields,
  describeNote,
  describeRuns,
  payeeWords,
  presetAmount,
  rangeWords,
  readAmount,
  recheck,
  reencodeNote,
  reencodes,
  shortHash,
  type AmountProblem,
  type ChangedRun,
  type FieldView,
  type Outcome,
} from "@/lib/attacker";
import { REFUSED_CHEAT_TX_SIGNATURE } from "@/lib/facts";
import { ERROR_WORDS, STAGE_WORDS, type ContextKind, type SerializedDeployment } from "@/lib/receipt";
import type { TestVector } from "@/lib/test-vector";
import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, ArrowUpRightIcon, CrossIcon } from "./icons";

const CARD = "min-w-0 rounded-card border-3 border-ink bg-surface p-5 shadow-hard";
const BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-full border-3 border-ink bg-surface px-5 py-2.5 font-bold text-ink shadow-hard transition-transform motion-safe:hover:-translate-y-0.5";
const FIELD_INPUT = "w-full min-w-0 rounded-xl border-2 border-ink bg-paper p-3 font-mono text-base text-ink";

const REFUSED_CHEAT_URL = `https://explorer.solana.com/tx/${REFUSED_CHEAT_TX_SIGNATURE}?cluster=devnet`;

const AMOUNT_PROBLEM_WORDS: Record<AmountProblem, string> = {
  format: "No check ran: enter a number with at most 6 decimals, for example 100.00.",
  zero: "No check ran: a note's amount must be above 0 (PAYMENT-V1 section 6), so it would be refused before its signature is checked.",
  too_large: `No check ran: a note's amount is 8 bytes, so it holds at most ${displayAmount(U64_MAX)} sandbox USD.`,
};

export function AttackerPanel({
  receipt,
  context,
  pinned,
  testVector,
}: {
  receipt: Uint8Array;
  context: ContextKind;
  pinned: SerializedDeployment | null;
  testVector: TestVector;
}) {
  const headingId = useId();
  const amountId = useId();
  const amountHelpId = useId();
  const payeeId = useId();
  const payeeHelpId = useId();
  const merchants = testVector.testMerchants;

  const signed = useMemo(() => {
    const noteBytes = receipt.slice(0, NOTE_LENGTH);
    const note = decodeNote(noteBytes);
    return {
      noteBytes,
      amountText: displayAmount(note.amount),
      amount: note.amount,
      payeeHex: toHex(note.payeeKeyHash),
      reencodes: reencodes(noteBytes),
      fields: describeNote(noteBytes, merchants),
    };
  }, [receipt, merchants]);

  const [amountDraft, setAmountDraft] = useState(signed.amountText);
  const [payeeHex, setPayeeHex] = useState(signed.payeeHex);

  const amount = readAmount(amountDraft);
  const amountUnits = "units" in amount ? amount.units : null;
  const attempt = useMemo(() => {
    if (!signed.reencodes || amountUnits === null) return null;
    const edited = reencodeNote(signed.noteBytes, { amount: amountUnits, payeeKeyHash: fromHex(payeeHex) });
    return {
      outcome: recheck(receipt, edited, pinned, testVector.deployment),
      fields: describeNote(edited, merchants),
    };
  }, [signed, amountUnits, payeeHex, receipt, pinned, testVector.deployment, merchants]);

  if (!signed.reencodes) {
    return (
      <section aria-labelledby={headingId} data-testid="attacker-panel" className={`${CARD} flex flex-col gap-3`}>
        <h3 id={headingId} className="text-2xl">
          Play the attacker
        </h3>
        <p>This note does not decode and encode back to the same 141 bytes, so this page cannot edit it.</p>
      </section>
    );
  }

  const preset = presetAmount(signed.amount);
  const runs: ChangedRun[] = attempt && attempt.outcome.kind !== "matches" ? attempt.outcome.runs : [];
  const changed = new Set(runs.flatMap((r) => Array.from({ length: r.last - r.first + 1 }, (_, k) => r.first + k)));
  const signer = context === "pinned" ? "the payer's phone" : "the payer's test key";
  const payeeOptions = [
    { value: signed.payeeHex, label: `As signed: ${payeeWords(signed.payeeHex, merchants)}` },
    ...merchants
      .filter((m) => m.keyHashHex !== signed.payeeHex)
      .map((m) => ({ value: m.keyHashHex, label: `${m.name}: ${shortHash(m.keyHashHex)}` })),
  ];

  function undo() {
    setAmountDraft(signed.amountText);
    setPayeeHex(signed.payeeHex);
  }

  return (
    <section aria-labelledby={headingId} data-testid="attacker-panel" className={`${CARD} flex flex-col gap-5`}>
      <div className="flex flex-col gap-2">
        <h3 id={headingId} className="text-2xl">
          Play the attacker
        </h3>
        <p>
          Change what this note says. The page encodes the edited 141 note bytes and runs the same signature check
          that verified this receipt above.
        </p>
        <p className="text-sm font-bold" data-testid="attacker-local">
          Everything here runs in this browser tab: the edited note is not sent anywhere and nothing is stored.
        </p>
      </div>

      <form
        aria-label="Edit the note"
        onSubmit={(e: FormEvent<HTMLFormElement>) => e.preventDefault()}
        className="grid min-w-0 gap-4 sm:grid-cols-2"
      >
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={amountId} className="font-bold">
            Amount (sandbox USD)
          </label>
          <input
            id={amountId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            value={amountDraft}
            onChange={(e) => setAmountDraft(e.target.value)}
            aria-describedby={amountHelpId}
            aria-invalid={"problem" in amount}
            className={FIELD_INPUT}
          />
          <p id={amountHelpId} className="text-sm text-muted">
            Signed: {signed.amountText}. Up to 6 decimals.
          </p>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={payeeId} className="font-bold">
            Merchant (payee key hash)
          </label>
          <select
            id={payeeId}
            value={payeeHex}
            onChange={(e) => setPayeeHex(e.target.value)}
            aria-describedby={payeeHelpId}
            className={FIELD_INPUT}
          >
            {payeeOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <p id={payeeHelpId} className="text-sm text-muted">
            The test merchants are public test keys from{" "}
            <code className="font-mono wrap-anywhere">protocol/vectors/payment-v1.json</code>.
          </p>
        </div>
        <div className="flex flex-wrap gap-3 sm:col-span-2">
          {preset !== null ? (
            <button type="button" className={BUTTON} onClick={() => setAmountDraft(displayAmount(preset))}>
              Make it {displayAmount(preset)}
            </button>
          ) : null}
          <button type="button" className={BUTTON} onClick={undo}>
            Undo: restore the signed note
          </button>
        </div>
      </form>

      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="attacker-result"
        data-outcome={attempt ? attempt.outcome.kind : "not_checked"}
        className="flex min-w-0 flex-col gap-2 rounded-xl border-2 border-ink bg-paper p-4"
      >
        {attempt ? (
          <Verdict outcome={attempt.outcome} signer={signer} />
        ) : (
          <>
            <OutlineChip label="Not checked" Icon={AlertIcon} />
            <p>{"problem" in amount ? AMOUNT_PROBLEM_WORDS[amount.problem] : ""}</p>
          </>
        )}
      </div>

      <NoteBytes fields={attempt?.fields ?? signed.fields} signedFields={signed.fields} changed={changed} />

      <div className="flex flex-col gap-1 border-t-2 border-ink/15 pt-4 text-sm" data-testid="attacker-chain-note">
        <p>
          The chain refuses an edited note too: the program redeems a note only after Solana&apos;s secp256r1
          precompile verifies the payer&apos;s signature over exactly those 141 bytes (PAYMENT-V1 section 8; the
          program&apos;s tests check this on a local validator in CI).
        </p>
        <p>
          Sending an edited note to devnet from this page is not built yet. The refused cheat already on devnet is a
          different one, a reused serial:{" "}
          <a
            href={REFUSED_CHEAT_URL}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="refused-cheat-link"
            className="inline-flex items-center gap-1 font-bold underline"
          >
            open it on Solana Explorer (devnet)
            <ArrowUpRightIcon />
          </a>
        </p>
      </div>
    </section>
  );
}

function changedWords(runs: ChangedRun[]): string {
  return `${changedCount(runs)} of ${NOTE_LENGTH} bytes changed: ${describeRuns(runs)} (${describeFields(runs)}).`;
}

function Verdict({ outcome, signer }: { outcome: Outcome; signer: string }) {
  switch (outcome.kind) {
    case "matches":
      return (
        <>
          <StateChip state="paid" label="Signature matches" testId="attacker-chip" />
          <p data-testid="attacker-verdict">
            These are the 141 bytes the payer signed, and the note signature check passes.
          </p>
        </>
      );
    case "signature_mismatch":
      return (
        <>
          <StateChip state="failed" label="Not verified" testId="attacker-chip" />
          <p className="text-lg font-bold" data-testid="attacker-verdict">
            Signature no longer matches: {signer} never signed this.
          </p>
          <p data-testid="attacker-changed">{changedWords(outcome.runs)}</p>
          <p className="text-sm">
            Error code <code className="font-mono font-bold">bad_signature</code>, from the note signature check.
            Undo puts back the bytes that were signed.
          </p>
        </>
      );
    case "other": {
      const { evaluation, runs } = outcome;
      return (
        <>
          <OutlineChip label="Not verified" Icon={CrossIcon} testId="attacker-chip" />
          <p className="font-bold" data-testid="attacker-verdict">
            {evaluation.kind === "failed"
              ? `${evaluation.located ? `Failed check: ${STAGE_WORDS[evaluation.located.stage]}. ` : ""}${
                  ERROR_WORDS[evaluation.code]
                }`
              : evaluation.kind === "verified"
                ? "The edited bytes passed the check, which should not be possible. Treat this page's result as broken."
                : "The check could not run on the edited note."}
          </p>
          {runs.length > 0 ? <p data-testid="attacker-changed">{changedWords(runs)}</p> : null}
          {evaluation.kind === "failed" ? (
            <p className="text-sm">
              Error code <code className="font-mono font-bold">{evaluation.code}</code>.
            </p>
          ) : null}
        </>
      );
    }
  }
}

function NoteBytes({
  fields,
  signedFields,
  changed,
}: {
  fields: FieldView[];
  signedFields: FieldView[];
  changed: Set<number>;
}) {
  return (
    <section aria-label="The note's 141 bytes, by field" className="flex min-w-0 flex-col gap-3">
      <div>
        <h4 className="text-xl">The note&apos;s 141 bytes, by field</h4>
        <p className="text-sm text-muted">
          Byte positions count from 0, as in PAYMENT-V1 section 4.1. Changed bytes are marked.
        </p>
      </div>
      <ol className="flex min-w-0 flex-col gap-3">
        {fields.map((view, index) => {
          const { field } = view;
          const fieldChanged = view.hex.some((_, k) => changed.has(field.start + k));
          const signedValue = signedFields[index].value;
          return (
            <li
              key={field.id}
              data-testid={`note-field-${field.id}`}
              data-changed={fieldChanged ? "true" : "false"}
              className={`flex min-w-0 flex-col gap-1 border-l-4 pl-3 ${
                fieldChanged ? "border-failed-strong" : index % 2 === 0 ? "border-ink" : "border-ink/30"
              }`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="font-bold">{field.label}</span>
                <span className="font-mono text-sm text-muted" data-testid={`note-field-${field.id}-range`}>
                  {rangeWords(field.start, field.end - 1)}
                </span>
                {fieldChanged ? (
                  <span className="rounded-full border-2 border-ink bg-failed-strong px-2 py-0.5 text-xs font-bold leading-none text-white">
                    Changed
                  </span>
                ) : null}
              </div>
              {/* wrap-anywhere: breaks inside a word only when it would not fit (a base58 id). */}
              <p className="wrap-anywhere" data-testid={`note-field-${field.id}-value`}>
                {view.value}
              </p>
              {fieldChanged && signedValue !== view.value ? (
                <p className="text-sm text-muted wrap-anywhere">Signed: {signedValue}</p>
              ) : null}
              <p aria-hidden="true" className="flex flex-wrap font-mono text-xs leading-5">
                {view.hex.map((h, k) => (
                  <span
                    key={k}
                    className={
                      changed.has(field.start + k)
                        ? "rounded-sm bg-failed-strong px-0.5 font-bold text-white underline"
                        : "px-0.5 text-muted"
                    }
                  >
                    {h}
                  </span>
                ))}
              </p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
