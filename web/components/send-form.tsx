"use client";

// /send (PLAN.md 3.3): the form, the request to POST /v1/remittances from this browser, the
// pending reposts, and the result. Every rule lives in lib/remittance.ts; this file only draws
// the states. The browser contacts api.zerobars.us only when the visitor presses Send.

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { SerializedDeployment } from "@/lib/receipt";
import {
  MAX_SEND_UNITS,
  REFUSALS,
  REMITTANCE_PATH,
  allowanceCode,
  browserPost,
  parseRecipient,
  parseSendAmount,
  sendRemittance,
  usd,
  verifyCertificate,
  type FinalOutcome,
  type RemittanceRequest,
  type Verification,
} from "@/lib/remittance";
import { explorerTx } from "@/lib/solana";
import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, CheckIcon, ClockIcon } from "./icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, Fact, Mono, OutLink } from "./judge-ui";
import { QrCode } from "./qr-code";

export type Verifier =
  | { ok: true; deployment: SerializedDeployment; keySource: "pinned" | "e2e_test" }
  | { ok: false; reason: string };

/** Whether sending is on, from the server's health check read on our server (app/send/page.tsx). */
export interface Availability {
  on: boolean;
  /** Why it is off, in plain words; null when on. */
  reason: string | null;
}

const INPUT =
  "w-full min-w-0 rounded-xl border-2 border-ink bg-paper p-3 font-mono text-base text-ink aria-[invalid=true]:border-warning-line";

function utc(seconds: string): string {
  const ms = Number(seconds) * 1000;
  if (!Number.isFinite(ms)) return seconds;
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}

function TxLink({ signature, testId }: { signature: string; testId: string }) {
  return (
    <OutLink href={explorerTx(signature)} testId={testId}>
      Open the transaction on the devnet explorer
    </OutLink>
  );
}

function Notice({ title, children, testId }: { title: string; children?: React.ReactNode; testId: string }) {
  return (
    <div role="status" data-testid={testId} className="flex min-w-0 gap-3 rounded-card border-3 border-warning-line bg-warning p-5 text-on-state">
      <AlertIcon className="mt-1 h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-2 break-words">
        <p className="font-bold">{title}</p>
        {children}
      </div>
    </div>
  );
}

function ServerOff({ reason }: { reason: string }) {
  return (
    <Notice title="Sending is off on the server right now." testId="send-off">
      <p className="text-sm">{reason}</p>
      <p className="text-sm">
        Nothing can be sent from this page until the settlement server runs POST /v1/remittances. The form comes back
        when its health check reports that route.
      </p>
    </Notice>
  );
}

function Certificate({ verification, code, keySource }: { verification: Verification; code: string; keySource: "pinned" | "e2e_test" | null }) {
  if (!verification.verified) {
    return (
      <div className="flex flex-col gap-3">
        <StateChip state="warning" label="Not verified" size="lg" testId="allowance-verdict" />
        <p data-testid="allowance-verdict-reason">
          The certificate the server returned does not check out: {verification.reason}. No code is shown, because a
          phone would refuse it.
        </p>
      </div>
    );
  }
  const c = verification.certificate;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <StateChip state="paid" label="Verified" size="lg" testId="allowance-verdict" />
        <p className="text-sm text-muted">
          {keySource === "e2e_test"
            ? "Checked in this browser against the e2e test key (test mode only, never on the real site)."
            : "Checked in this browser against the settlement server's key in config/pins.json."}
        </p>
      </div>
      <dl className="flex flex-col gap-3">
        <Fact label="New allowance" testId="cert-allowance-id">
          <Mono>{c.allowanceId}</Mono>
        </Fact>
        <Fact label="Payer key hash" testId="cert-payer">
          <Mono>{c.payerKeyHashHex}</Mono>
        </Fact>
        <Fact label="Cap" testId="cert-cap">
          {usd(c.capUnits)} sandbox USDC
        </Fact>
        <Fact label="Offline limit" testId="cert-offline-limit">
          {usd(c.offlineLimitUnits)} sandbox USDC
        </Fact>
        <Fact label="Expires" testId="cert-expiry">
          {utc(c.expiry)}
        </Fact>
        <Fact label="Merchants it can pay" testId="cert-earmarks">
          {c.earmarks.length === 0 ? "Any merchant" : `${c.earmarks.length} earmarked merchant${c.earmarks.length === 1 ? "" : "s"}, set by the server`}
        </Fact>
      </dl>
      <figure className="flex flex-col gap-3">
        <QrCode text={code} label="QR code of the allowance certificate" testId="allowance-qr" />
        <figcaption className="flex flex-col gap-1">
          <span className="font-bold">Scan this with the payer phone to spend it with no signal.</span>
          <span className="text-sm text-muted">
            The code is the signed certificate as LOKA payment content (L1|P|1|A). The phone needs an iPhone app build
            that includes the allowance import change (merged Oct 10) to read it.
          </span>
        </figcaption>
      </figure>
      <details className="min-w-0">
        <summary className="cursor-pointer font-bold">The code as text</summary>
        <p className="mt-2 break-all font-mono text-sm" data-testid="allowance-code">
          {code}
        </p>
      </details>
    </div>
  );
}

function Result({
  outcome,
  verifier,
  onRetry,
}: {
  outcome: FinalOutcome;
  verifier: Verifier;
  onRetry: () => void;
}) {
  const retry = (
    <button type="button" onClick={onRetry} className={`${BUTTON_SECONDARY} w-fit`} data-testid="send-retry">
      Send the same request again
    </button>
  );
  switch (outcome.kind) {
    case "success": {
      const s = outcome.success;
      const verification: Verification = verifier.ok
        ? verifyCertificate(s, verifier.deployment)
        : { verified: false, reason: verifier.reason };
      return (
        <div className="flex flex-col gap-4" data-testid="send-result" data-kind="success">
          <StateChip state="paid" label="Allowance opened on devnet" testId="send-status" />
          {outcome.created ? null : (
            <p data-testid="send-repeat">
              This recipient already had a live send. The server returned that send&apos;s first terms; nothing new was
              funded.
            </p>
          )}
          <p>
            Recipient allowance <Mono>{s.recipientAllowanceId}</Mono>; new allowance <Mono>{s.allowanceId}</Mono>.
          </p>
          <TxLink signature={s.signature} testId="send-explorer" />
          <Certificate verification={verification} code={allowanceCode(s.allowBytes)} keySource={verifier.ok ? verifier.keySource : null} />
        </div>
      );
    }
    case "still_pending":
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="still_pending">
          <StateChip state="pending" label="Still pending" testId="send-status" />
          <p>
            The server had not seen devnet confirm the funding after 30 seconds. The send is not lost: the server keeps
            it, and sending the same request again only checks on it, since one recipient gets one live send.
          </p>
          {outcome.signature ? <TxLink signature={outcome.signature} testId="send-explorer" /> : null}
          {retry}
        </div>
      );
    case "failed_on_chain":
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="failed_on_chain">
          <StateChip state="failed" label="Failed on devnet" testId="send-status" />
          <p>The funding transaction failed on devnet, so the server issued no certificate.</p>
          {outcome.signature ? <TxLink signature={outcome.signature} testId="send-explorer" /> : null}
        </div>
      );
    case "refused": {
      const r = REFUSALS[outcome.error];
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="refused" data-error={outcome.error}>
          <StateChip state="warning" label="Not sent" testId="send-status" />
          <p data-testid="send-message">{r.message}</p>
          {outcome.retryAfterSeconds !== null ? (
            <p className="text-sm text-muted">The server asked to wait {outcome.retryAfterSeconds} seconds.</p>
          ) : null}
          {r.retryable ? retry : null}
        </div>
      );
    }
    case "server_off":
      return null;
    case "network":
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="network">
          <StateChip state="warning" label="No answer" testId="send-status" />
          <p data-testid="send-message">
            Your browser {outcome.reason}. The server only accepts requests from https://zerobars.us, so a preview
            build cannot reach it.
          </p>
          {retry}
        </div>
      );
    case "timeout":
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="timeout">
          <StateChip state="warning" label="No answer" testId="send-status" />
          <p data-testid="send-message">
            No answer within {outcome.seconds} seconds. The server may still be working on it; sending the same request
            again checks on it and never funds the same recipient twice.
          </p>
          {retry}
        </div>
      );
    case "unexpected":
      return (
        <div className="flex flex-col gap-3" data-testid="send-result" data-kind="unexpected">
          <StateChip state="warning" label="Unexpected answer" testId="send-status" />
          <p data-testid="send-message">
            The server answered HTTP {outcome.status}, which the API contract does not describe ({outcome.detail}).
            Nothing is shown as sent.
          </p>
        </div>
      );
  }
}

export function SendForm({ apiBase, availability, verifier }: { apiBase: string; availability: Availability; verifier: Verifier }) {
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("1.00");
  const [problems, setProblems] = useState<{ recipient: string | null; amount: string | null }>({ recipient: null, amount: null });
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ signature: string | null; waitSeconds: number } | null>(null);
  const [outcome, setOutcome] = useState<FinalOutcome | null>(null);
  const [offReason, setOffReason] = useState<string | null>(availability.on ? null : (availability.reason ?? "The server does not report the send route."));
  const lastRequest = useRef<RemittanceRequest | null>(null);
  const alive = useRef(true);
  const resultRef = useRef<HTMLDivElement>(null);
  const recipientId = useId();
  const amountId = useId();
  const recipientHelp = useId();
  const amountHelp = useId();
  const recipientError = useId();
  const amountError = useId();

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    if (outcome) resultRef.current?.focus();
  }, [outcome]);

  async function run(request: RemittanceRequest) {
    lastRequest.current = request;
    setSending(true);
    setOutcome(null);
    setPending(null);
    const result = await sendRemittance(request, {
      post: browserPost(`${apiBase}${REMITTANCE_PATH}`),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      onPending: (p, waitSeconds) => {
        if (alive.current) setPending({ signature: p.signature, waitSeconds });
      },
    });
    if (!alive.current) return;
    setSending(false);
    setPending(null);
    if (result.kind === "server_off") {
      setOffReason("The server answered that it has no POST /v1/remittances route (404 unknown_route).");
      return;
    }
    setOutcome(result);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    const r = parseRecipient(recipient);
    const a = parseSendAmount(amount);
    setProblems({ recipient: r.ok ? null : r.problem, amount: a.ok ? null : a.problem });
    if (!r.ok || !a.ok) return;
    void run({ recipientAllowanceId: r.value, amountUnits: a.value });
  }

  function onRetry() {
    if (!sending && lastRequest.current) void run(lastRequest.current);
  }

  if (offReason !== null) {
    return (
      <section className={`${CARD} flex flex-col gap-4`} aria-label="Send">
        <h2 className="text-2xl sm:text-3xl">Send</h2>
        <ServerOff reason={offReason} />
      </section>
    );
  }

  return (
    <section className={`${CARD} flex flex-col gap-6`} aria-label="Send">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl sm:text-3xl">Send</h2>
        <OutlineChip label="Server reports the route" Icon={CheckIcon} testId="send-on" />
      </div>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5" aria-label="Send sandbox money">
        <div className="flex flex-col gap-2">
          <label htmlFor={recipientId} className="font-bold">
            Recipient allowance id
          </label>
          <p id={recipientHelp} className="text-sm text-muted">
            The payer phone&apos;s allowance id: the number it shows, or its code as text (
            <code className="font-mono">LOKA-ALLOWANCE:</code> then the number).
          </p>
          <input
            id={recipientId}
            name="recipient"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={problems.recipient ? true : undefined}
            aria-describedby={`${recipientHelp}${problems.recipient ? ` ${recipientError}` : ""}`}
            className={INPUT}
            data-testid="send-recipient"
          />
          {problems.recipient ? (
            <p id={recipientError} className="text-sm font-bold" data-testid="send-recipient-problem">
              {problems.recipient}
            </p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor={amountId} className="font-bold">
            Amount (sandbox USDC)
          </label>
          <p id={amountHelp} className="text-sm text-muted">
            At most {usd(MAX_SEND_UNITS)}. Test tokens on devnet with no value.
          </p>
          <input
            id={amountId}
            name="amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            autoComplete="off"
            aria-invalid={problems.amount ? true : undefined}
            aria-describedby={`${amountHelp}${problems.amount ? ` ${amountError}` : ""}`}
            className={INPUT}
            data-testid="send-amount"
          />
          {problems.amount ? (
            <p id={amountError} className="text-sm font-bold" data-testid="send-amount-problem">
              {problems.amount}
            </p>
          ) : null}
        </div>
        <button type="submit" disabled={sending} className={`${BUTTON_PRIMARY} w-fit disabled:opacity-60`} data-testid="send-submit">
          {sending ? "Sending..." : "Send sandbox money"}
        </button>
      </form>

      <div aria-live="polite">
        {sending ? (
          <div className="flex items-start gap-2" data-testid="send-progress">
            <ClockIcon className="mt-1 h-4 w-4 shrink-0" />
            <p className="min-w-0 break-words">
              {pending
                ? `Pending: the server has not seen devnet confirm the funding yet. Sending the same request again in ${pending.waitSeconds} s (for up to 30 s in all).`
                : "Waiting for the server: it opens the allowance on devnet and waits for confirmation."}
            </p>
          </div>
        ) : null}
        {sending && pending?.signature ? <TxLink signature={pending.signature} testId="send-pending-explorer" /> : null}
      </div>

      {outcome ? (
        <div ref={resultRef} tabIndex={-1} className="flex flex-col gap-4 outline-none">
          <Result outcome={outcome} verifier={verifier} onRetry={onRetry} />
        </div>
      ) : null}
    </section>
  );
}
