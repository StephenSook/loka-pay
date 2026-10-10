"use client";

// /verify: the receipt is read from the URL fragment or pasted, and every signature is
// checked here in the browser with @lokapay/protocol. No request, no login, no storage.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { toHex } from "@lokapay/protocol";
import {
  ACK_MISMATCH_WORDS,
  CHECK_LABELS,
  ERROR_WORDS,
  STAGE_WORDS,
  TRANSPORT_KIND_WORDS,
  evaluate,
  formatDuration,
  formatUnixUtc,
  readFragment,
  type CheckId,
  type CheckState,
  type Checks,
  type ContextKind,
  type Evaluation,
  type InputProblem,
  type ReceiptStatus,
  type ReceiptView,
  type SerializedDeployment,
} from "@/lib/receipt";
import type { TestVector } from "@/lib/test-vector";
import { AttackerPanel } from "./attacker-panel";
import { OutlineChip, StateChip, type MoneyState } from "./chips";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, CircleIcon, ClockIcon, CrossIcon, FlaskIcon } from "./icons";

const PINS_NOTICE =
  "The settlement server's key is not published yet, so confirmations cannot be checked on this page.";

// ---------- the URL fragment as an external store ----------

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}
const readHash = () => window.location.hash;
const readServerHash = () => "";

type Origin = "link" | "pasted" | "test";

const CARD = "min-w-0 rounded-card border-3 border-ink bg-surface p-5 shadow-hard";
const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full border-3 border-ink bg-ink px-6 py-3 font-bold text-paper shadow-hard transition-transform motion-safe:hover:-translate-y-0.5";
const BUTTON_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-full border-3 border-ink bg-surface px-6 py-3 font-bold text-ink shadow-hard transition-transform motion-safe:hover:-translate-y-0.5";

export function ReceiptVerifier({
  pinned,
  testVector,
}: {
  pinned: SerializedDeployment | null;
  testVector: TestVector;
}) {
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const [draft, setDraft] = useState("");
  const [submitted, setSubmitted] = useState<{ text: string; origin: Origin; hashAtSubmit: string } | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const helpId = useId();

  // The newest thing wins: a receipt submitted here, unless the fragment changed after it.
  const fragment = readFragment(hash);
  let active: { text: string; origin: Origin } | null = null;
  if (submitted && (submitted.hashAtSubmit === hash || fragment === null)) active = submitted;
  else if (fragment !== null) active = { text: fragment, origin: "link" };

  const activeText = active?.text ?? null;
  const vectorDeployment = testVector.deployment;
  const evaluation = useMemo(
    () => (activeText === null ? null : evaluate(activeText, pinned, vectorDeployment)),
    [activeText, pinned, vectorDeployment],
  );

  // Move focus to the result after a submission here, so keyboard and screen reader
  // users land on it. A receipt opened from a link does not steal focus.
  useEffect(() => {
    if (submitted) resultRef.current?.focus();
  }, [submitted]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted({ text: draft, origin: "pasted", hashAtSubmit: hash });
  }

  function onTryTestReceipt() {
    setDraft(testVector.transport);
    setSubmitted({ text: testVector.transport, origin: "test", hashAtSubmit: hash });
  }

  return (
    <div className="flex flex-col gap-8">
      <form onSubmit={onSubmit} className={`${CARD} flex flex-col gap-4`} aria-label="Receipt to verify">
        <label htmlFor={inputId} className="text-2xl font-display font-extrabold tracking-display">
          Receipt
        </label>
        <p id={helpId} className="text-muted">
          Paste a receipt link, the <code className="font-mono text-sm">L1|P|1|X|...</code> text, or the
          receipt&apos;s base64url bytes.
        </p>
        <textarea
          id={inputId}
          aria-describedby={helpId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={5}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          className="w-full min-w-0 resize-y break-all rounded-xl border-2 border-ink bg-paper p-3 font-mono text-sm text-ink"
        />
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={BUTTON_PRIMARY}>
            Verify
          </button>
          <button type="button" onClick={onTryTestReceipt} className={BUTTON_SECONDARY}>
            <FlaskIcon />
            Try the published test receipt
          </button>
        </div>
        <p className="text-sm text-muted">
          The test receipt is a published test vector made from public test keys. It is not a real payment.
        </p>
      </form>

      {/* One short sentence for screen readers; the full result below is not live. */}
      <p aria-live="polite" className="sr-only">
        {evaluation ? summarize(evaluation) : ""}
      </p>

      <div
        ref={resultRef}
        tabIndex={-1}
        aria-label="Verification result"
        data-testid="verify-result"
        className="flex min-w-0 flex-col gap-6 outline-offset-4"
      >
        {evaluation && active ? (
          <Result evaluation={evaluation} origin={active.origin} pinned={pinned} testVector={testVector} />
        ) : (
          <Waiting />
        )}
      </div>

      <DeploymentInfo pinned={pinned} />
    </div>
  );
}

function summarize(evaluation: Evaluation): string {
  const prefix = "context" in evaluation && evaluation.context === "test_vector" ? "Test vector. " : "";
  switch (evaluation.kind) {
    case "verified":
      return `${prefix}${STATUS_CHIP[evaluation.view.status].label}. Every check passed.`;
    case "failed":
      return `${prefix}Not verified. ${
        evaluation.located ? `Failed check: ${STAGE_WORDS[evaluation.located.stage]}. ` : ""
      }Error code ${evaluation.code}.`;
    case "input":
      return `Not a receipt. ${inputProblemWords(evaluation.problem)}`;
    case "no_deployment":
      return `Not checked. ${PINS_NOTICE}`;
    case "unexpected":
      return "Not verified. The check stopped with an unexpected error.";
  }
}

// ---------- result ----------

function Waiting() {
  return (
    <div className="rounded-card border-2 border-dashed border-ink p-5">
      <h2 className="text-2xl">Result</h2>
      <p className="mt-2 text-muted">Nothing checked yet. Paste a receipt, open a receipt link, or try the test receipt.</p>
    </div>
  );
}

const ORIGIN_WORDS: Record<Origin, string> = {
  link: "From the link (the part after #r=, which never reaches a server).",
  pasted: "From the text box.",
  test: "The published test receipt.",
};

interface CheckSetup {
  pinned: SerializedDeployment | null;
  testVector: TestVector;
}

function Result({ evaluation, origin, ...setup }: { evaluation: Evaluation; origin: Origin } & CheckSetup) {
  return (
    <>
      <div className="flex flex-col gap-1">
        <h2 className="text-3xl">Result</h2>
        <p className="text-sm text-muted">{ORIGIN_WORDS[origin]}</p>
      </div>
      <ResultBody evaluation={evaluation} {...setup} />
    </>
  );
}

function ResultBody({ evaluation, pinned, testVector }: { evaluation: Evaluation } & CheckSetup) {
  switch (evaluation.kind) {
    case "input":
      return <InputProblemCard problem={evaluation.problem} />;
    case "no_deployment":
      return <NoDeploymentCard tooShort={evaluation.tooShort} />;
    case "verified":
      return (
        <>
          <ContextBanner context={evaluation.context} />
          <StatusCard view={evaluation.view} />
          <Checklist checks={evaluation.checks} context={evaluation.context} />
          <Fields view={evaluation.view} context={evaluation.context} />
          {/* Keyed by the bytes, so a newly verified receipt starts with its own signed values. */}
          <AttackerPanel
            key={toHex(evaluation.bytes)}
            receipt={evaluation.bytes}
            pinned={pinned}
            testVector={testVector}
          />
        </>
      );
    case "failed":
      return (
        <>
          <ContextBanner context={evaluation.context} />
          <FailureCard evaluation={evaluation} />
          {evaluation.located ? <Checklist checks={evaluation.located.checks} context={evaluation.context} /> : null}
        </>
      );
    case "unexpected":
      return (
        <div className={`${CARD} flex flex-col gap-3`}>
          <OutlineChip label="Not verified" Icon={CrossIcon} size="lg" testId="receipt-status" />
          <p>The check stopped with an unexpected error, so nothing is shown as verified: {evaluation.message}</p>
        </div>
      );
  }
}

function inputProblemWords(problem: InputProblem): string {
  switch (problem.kind) {
    case "empty":
      return "The text box is empty. Paste a receipt first.";
    case "too_long":
      return `That is ${problem.length.toLocaleString("en-US")} characters. A receipt is under 900, so this cannot be one.`;
    case "no_fragment":
      return "That link has no receipt in it. A receipt link carries the receipt after #r=.";
    case "not_payment":
      return "That text is not version 1 LOKA Pay payment content.";
    case "wrong_kind":
      return `That is ${TRANSPORT_KIND_WORDS[problem.found] ?? "another kind of payment content"}, not a receipt. A receipt starts with L1|P|1|X|.`;
    case "decode":
      return ERROR_WORDS[problem.code];
  }
}

function InputProblemCard({ problem }: { problem: InputProblem }) {
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <OutlineChip label="Not a receipt" Icon={CrossIcon} size="lg" testId="receipt-status" />
      <p>{inputProblemWords(problem)}</p>
      {problem.kind === "decode" ? <ErrorCode code={problem.code} /> : null}
    </div>
  );
}

function NoDeploymentCard({ tooShort }: { tooShort: boolean }) {
  return (
    <div className={`${CARD} flex flex-col gap-3`} data-testid="pins-notice">
      <OutlineChip label="Not checked" Icon={AlertIcon} size="lg" testId="receipt-status" />
      <p className="text-lg font-bold">{PINS_NOTICE}</p>
      <p>
        The deployment&apos;s program id and mint are not published either, so this page did not check this
        receipt&apos;s signatures. Nothing on it is shown as verified.
      </p>
      {tooShort ? <p>It is also too short to be a receipt: a receipt is at least 392 bytes.</p> : null}
    </div>
  );
}

function ContextBanner({ context }: { context: ContextKind }) {
  if (context === "test_vector") {
    return (
      <div
        data-testid="test-vector-notice"
        className="flex min-w-0 gap-3 rounded-card border-3 border-warning-line bg-warning p-5 text-on-state"
      >
        <FlaskIcon className="mt-1 h-5 w-5 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-bold">Test vector, not a real payment.</p>
          <p>
            This receipt comes from <code className="break-all font-mono text-sm">protocol/vectors/payment-v1.json</code>.
            It was made with public test keys, so anyone can make one like it, and it was checked against the test
            deployment and the test server key published in that file. No money moved, not even sandbox money.
          </p>
        </div>
      </div>
    );
  }
  return (
    <p className="text-sm text-muted">
      Checked against the published devnet deployment and server key in <code className="font-mono">config/pins.json</code>.
    </p>
  );
}

const STATUS_CHIP: Record<ReceiptStatus, { state: MoneyState; label: string; sentence: string }> = {
  settled: {
    state: "paid",
    label: "Settled",
    sentence: "The settlement server signed that this payment settled on Solana devnet.",
  },
  failed_on_chain: {
    state: "failed",
    label: "Failed on chain",
    sentence: "The settlement server signed that this payment's transaction reached Solana devnet and failed there.",
  },
  refused_off_chain: {
    state: "warning",
    label: "Refused",
    sentence: "The settlement server signed that it refused this payment before it reached the chain.",
  },
  pending: {
    state: "pending",
    label: "Pending",
    sentence:
      "No server confirmation is attached. The payer's note and the merchant's acknowledgement verify, but nothing here shows that the payment settled.",
  },
};

function StatusCard({ view }: { view: ReceiptView }) {
  const { state, label, sentence } = STATUS_CHIP[view.status];
  return (
    <div className={`${CARD} flex flex-col gap-3`}>
      <p className="text-sm font-bold uppercase tracking-wide text-muted">Status, from the signed confirmation</p>
      <div className="flex flex-wrap items-center gap-3">
        <StateChip state={state} label={label} size="lg" testId="receipt-status" />
        <span className="text-lg font-bold">{view.amount} sandbox USD</span>
      </div>
      <p>{sentence}</p>
      {view.status === "failed_on_chain" && view.conf ? (
        <p>Program error code {view.conf.errorCode}.</p>
      ) : null}
    </div>
  );
}

function FailureCard({ evaluation }: { evaluation: Extract<Evaluation, { kind: "failed" }> }) {
  const { located, code } = evaluation;
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-card border-3 border-failed-strong bg-surface p-5 shadow-hard">
      <OutlineChip label="Not verified" Icon={CrossIcon} size="lg" testId="receipt-status" />
      {located ? (
        <p className="text-lg font-bold" data-testid="failed-check">
          Failed check: {STAGE_WORDS[located.stage]}
        </p>
      ) : (
        <p className="text-lg font-bold" data-testid="failed-check">
          This page could not tell which check failed.
        </p>
      )}
      <p>
        {ERROR_WORDS[code]}
        {located?.ackMismatch ? ` ${ACK_MISMATCH_WORDS[located.ackMismatch]}` : ""}
      </p>
      <ErrorCode code={code} />
      <p className="text-sm text-muted">
        No status is shown: a status counts only after every check passes (PAYMENT-V1 section 4.9).
      </p>
    </div>
  );
}

function ErrorCode({ code }: { code: string }) {
  return (
    <p className="text-sm">
      Error code:{" "}
      <code data-testid="failure-code" className="rounded border-2 border-ink px-1.5 py-0.5 font-mono font-bold">
        {code}
      </code>
    </p>
  );
}

// ---------- checklist ----------

const CHECK_ORDER: CheckId[] = ["note", "ack", "conf", "ids"];

const MARKS: Record<CheckState, { word: string; Icon: (props: { className?: string }) => React.ReactElement }> = {
  passed: { word: "Passed", Icon: CheckIcon },
  failed: { word: "Failed", Icon: CrossIcon },
  not_run: { word: "Not run", Icon: CircleIcon },
  not_attached: { word: "No confirmation attached", Icon: ClockIcon },
};

function checkDetail(id: CheckId, context: ContextKind): string {
  if (id !== "conf") return CHECK_LABELS[id].detail;
  return context === "test_vector"
    ? "The settlement server's Ed25519 signature over the confirmation verifies with the published test server key."
    : "The settlement server's Ed25519 signature over the confirmation verifies with the server key in config/pins.json.";
}

function Checklist({ checks, context }: { checks: Checks; context: ContextKind }) {
  return (
    <section aria-label="Checks" className={`${CARD} flex flex-col gap-4`}>
      <h3 className="text-2xl">Checks</h3>
      <ul className="flex flex-col gap-4">
        {CHECK_ORDER.map((id) => {
          const { word, Icon } = MARKS[checks[id]];
          return (
            <li key={id} data-testid={`check-${id}`} data-state={checks[id]} className="flex min-w-0 gap-3">
              <span
                className={`inline-flex h-fit shrink-0 items-center gap-1.5 rounded-full border-2 px-2.5 py-1 text-sm font-bold leading-none ${
                  checks[id] === "passed"
                    ? "border-ink bg-paid-strong text-white"
                    : checks[id] === "failed"
                      ? "border-ink bg-failed-strong text-white"
                      : "border-ink bg-surface text-ink"
                }`}
              >
                <Icon />
                {word}
              </span>
              <div className="min-w-0">
                <p className="font-bold">{CHECK_LABELS[id].title}</p>
                <p className="text-sm text-muted">{checkDetail(id, context)}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------- fields ----------

function Time({ seconds }: { seconds: bigint }) {
  const utc = formatUnixUtc(seconds);
  return (
    <>
      {utc ?? "Outside the range this page can show as a date"}{" "}
      <span className="text-muted">({seconds.toString()} unix seconds)</span>
    </>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="break-all font-mono text-sm">{children}</span>;
}

function Row({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t-2 border-ink/15 pt-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="font-bold">{label}</dt>
      <dd className="min-w-0" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

const CONF_STATUS_WORDS: Record<1 | 2 | 3, string> = {
  1: "Settled (status 1)",
  2: "Failed on chain (status 2)",
  3: "Refused before reaching the chain (status 3)",
};

function Fields({ view, context }: { view: ReceiptView; context: ContextKind }) {
  const { conf } = view;
  return (
    <section aria-label="What the receipt says" className={`${CARD} flex flex-col gap-4`}>
      <div>
        <h3 className="text-2xl">What the receipt says</h3>
        <p className="mt-1 text-sm text-muted">Every value below is covered by a signature that passed.</p>
      </div>
      <dl className="flex flex-col gap-3">
        <Row label="Amount" testId="field-amount">
          {view.amount} sandbox USD
        </Row>
        <Row label="Payee key hash">
          <Mono>{view.payeeKeyHashHex}</Mono>
        </Row>
        <Row label="Payer key hash">
          <Mono>{view.payerKeyHashHex}</Mono>
        </Row>
        <Row label="Note id" testId="field-note-id">
          <Mono>{view.noteIdHex}</Mono>
        </Row>
        <Row label="Allowance id">{view.allowanceId}</Row>
        <Row label="Serial">{view.serial}</Row>
        <Row label="Note expiry">
          <Time seconds={view.expiry} />
        </Row>
        <Row label="Received at (merchant phone clock)">
          <Time seconds={view.receivedAt} />
        </Row>
        <Row label="Confirmation status" testId="field-conf-status">
          {conf ? CONF_STATUS_WORDS[conf.statusCode] : "No confirmation attached"}
        </Row>
        {conf ? (
          <>
            {conf.statusCode === 2 ? <Row label="Program error code">{conf.errorCode}</Row> : null}
            <Row label="Slot">
              {conf.slot.toString()}
              {conf.statusCode === 3 ? <span className="text-muted"> (refused, never sent to the chain)</span> : null}
            </Row>
            <Row label="Block time (chain clock)">
              {conf.statusCode === 3 ? (
                <>
                  {conf.blockTime.toString()} <span className="text-muted">(refused, never sent to the chain)</span>
                </>
              ) : (
                <Time seconds={conf.blockTime} />
              )}
            </Row>
            <Row label="Uploaded at (server clock)">
              <Time seconds={conf.uploadedAt} />
            </Row>
          </>
        ) : null}
        {view.heldOfflineSeconds !== null ? (
          <Row label="Held offline" testId="field-held-offline">
            {formatDuration(view.heldOfflineSeconds)}{" "}
            <span className="text-muted">
              (uploaded at, server clock, minus received at, merchant phone clock
              {view.heldOfflineSeconds < BigInt(0) ? "; negative means the two clocks disagree" : ""})
            </span>
          </Row>
        ) : null}
        {conf?.explorerUrl ? (
          <Row label="Transaction">
            <a
              href={conf.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="explorer-link"
              className="inline-flex items-center gap-1.5 font-bold underline"
            >
              Open on Solana Explorer (devnet)
              <ArrowUpRightIcon />
            </a>
            <span className="mt-1 block text-sm">
              <Mono>{conf.txSignatureBase58}</Mono>
            </span>
            {context === "test_vector" ? (
              <span className="mt-1 block text-sm text-muted">
                The test vector&apos;s transaction signature was never sent to devnet, so the explorer will not find it.
              </span>
            ) : null}
          </Row>
        ) : null}
      </dl>
    </section>
  );
}

// ---------- deployment ----------

function DeploymentInfo({ pinned }: { pinned: SerializedDeployment | null }) {
  return (
    <section aria-label="What this page checks against" className="flex flex-col gap-3">
      <h2 className="text-2xl">What this page checks against</h2>
      {pinned ? (
        <dl className="flex flex-col gap-3" data-testid="pinned-deployment">
          <Row label="Program id (devnet)">
            <Mono>{pinned.programIdBase58}</Mono>
          </Row>
          <Row label="Mint">
            <Mono>{pinned.mintBase58}</Mono>
          </Row>
          <Row label="Server Ed25519 key">
            <Mono>{pinned.serverPublicKeyHex}</Mono>
          </Row>
        </dl>
      ) : (
        <p data-testid="deployment-unpublished">{PINS_NOTICE}</p>
      )}
      <p className="text-muted">
        Receipts made with the published test vectors are checked against the test keys in{" "}
        <code className="break-all font-mono text-sm">protocol/vectors/payment-v1.json</code> and are labelled as
        test vectors. Everything runs in this browser tab: the receipt is not sent anywhere and nothing is stored.
      </p>
    </section>
  );
}
