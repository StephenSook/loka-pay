"use client";

// /call (PLAN.md 3.9): the number, the language and the two buttons. The number lives in this
// component's state only (never localStorage or a cookie) and leaves the browser once, in the
// body of POST /api/call to this site, when a button is pressed or, for "the next payment",
// when that payment settles. "The next payment" watches the program from this browser with
// the same engine as /live (lib/program-feed.ts); nothing opens until that button is pressed.

import { useEffect, useId, useState } from "react";
import {
  SIGNATURE_MAX_AGE_MS,
  isNewSettlement,
  normalizeUsNumber,
  type CallAnswer,
  type CallLang,
  type CalledPayment,
  type RateLimitReason,
} from "@/lib/call-shared";
import { WOLOF, offeredCallLangs } from "@/lib/call-wolof";
import { ProgramFeed, type Connection } from "@/lib/program-feed";
import { formatUnits } from "@/lib/vault";
import { OutlineChip, StateChip } from "./chips";
import { PhoneIcon } from "./icons";
import { BUTTON_PRIMARY, BUTTON_SECONDARY, CARD, Mono, OutLink, When } from "./judge-ui";

type Phase =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "waiting"; sinceMs: number }
  | { kind: "calling"; payment: CalledPayment }
  | { kind: "rate_limited"; retryAfterSeconds: number; limit: RateLimitReason | null }
  | { kind: "no_payment" }
  | { kind: "too_old" }
  | { kind: "wrong_code" }
  | { kind: "off" }
  | { kind: "failed"; reason: string };

const FIELD = "w-full min-w-0 rounded-xl border-2 border-ink bg-paper p-3 text-base text-ink";

/**
 * The language menu: English and French, and Wolof only once lib/call-wolof.ts offers it (its
 * script complete and rated understandable by a native speaker after a real test call).
 */
const LANGS = offeredCallLangs();
const LANG_OPTION: Record<CallLang, { label: string; lang?: string }> = {
  en: { label: "English" },
  fr: { label: "Français", lang: "fr" },
  wo: { label: WOLOF.script.optionLabel, lang: "wo" },
};

/** What an answer from POST /api/call means for the page. */
function phaseOf(status: number, body: CallAnswer | null, retryAfter: string | null): Phase {
  if (body !== null && "status" in body && body.status === "calling") return { kind: "calling", payment: body.payment };
  if (body === null || !("error" in body)) return { kind: "failed", reason: `this site's server answered HTTP ${status}` };
  switch (body.error) {
    case "calls_off":
      return { kind: "off" };
    case "rate_limited":
      return { kind: "rate_limited", retryAfterSeconds: body.retryAfterSeconds ?? (Number(retryAfter) || 60), limit: body.limit ?? null };
    case "no_settled_payment":
      return { kind: "no_payment" };
    case "too_old":
      return { kind: "too_old" };
    case "wrong_code":
      return { kind: "wrong_code" };
    default:
      return { kind: "failed", reason: body.reason ? `${body.error}, ${body.reason}` : body.error };
  }
}

interface CallBody {
  to: string;
  lang: CallLang;
  signature?: string;
  /** The desk code, sent only when this site asks for one. */
  code?: string;
}

async function postCall(body: CallBody, setPhase: (p: Phase) => void): Promise<void> {
  setPhase({ kind: "sending" });
  let response: Response;
  try {
    response = await fetch("/api/call", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    setPhase({ kind: "failed", reason: "could not reach this site's server" });
    return;
  }
  let answer: CallAnswer | null = null;
  try {
    answer = (await response.json()) as CallAnswer;
  } catch {
    // Shown as the HTTP status.
  }
  setPhase(phaseOf(response.status, answer, response.headers.get("retry-after")));
}

/** "45 s" under two minutes, else whole minutes rounded up. */
function waitWords(seconds: number): string {
  return seconds < 120 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
}

function connectionWords(c: Connection): string {
  switch (c.kind) {
    case "connecting":
      return "connecting to devnet";
    case "live":
      return "live";
    case "stalled":
      return `no update from devnet for ${Math.floor(c.silentMs / 1000)} s`;
    case "reconnecting":
      return `reconnecting, attempt ${c.attempt}`;
    case "failed":
      return `stopped: ${c.reason}`;
  }
}

export function CallPanel({ programId, enabled, codeRequired }: { programId: string; enabled: boolean; codeRequired: boolean }) {
  const numberId = useId();
  const numberHelpId = useId();
  const langId = useId();
  const codeId = useId();
  const codeHelpId = useId();
  const [draft, setDraft] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [lang, setLang] = useState<CallLang>("en");
  const [numberError, setNumberError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>(enabled ? { kind: "idle" } : { kind: "off" });
  const [watch, setWatch] = useState<CallBody | null>(null);
  const [connection, setConnection] = useState<Connection>({ kind: "connecting" });

  // Armed: watch the program from this browser until a new settlement is read in full, then
  // post its signature once and stop watching.
  useEffect(() => {
    if (watch === null) return;
    const feed = new ProgramFeed(programId);
    let before: Set<string> | null = null;
    let fired = false;
    const unsubscribe = feed.subscribe((state) => {
      if (fired) return;
      if (before === null && state.history.kind === "ok") {
        before = new Set(state.rows.filter((r) => !r.arrivedLive).map((r) => r.signature));
      }
      const hit = state.rows.find((r) => isNewSettlement(r, before));
      if (hit) {
        fired = true;
        setWatch(null);
        void postCall({ ...watch, signature: hit.signature }, setPhase);
        return;
      }
      setConnection(state.connection);
    });
    feed.start();
    return () => {
      unsubscribe();
      feed.stop();
    };
  }, [watch, programId]);

  const busy = phase.kind === "sending" || watch !== null;

  /** The request body from the fields, or null after saying on the page what is missing. */
  function readForm(): CallBody | null {
    const to = normalizeUsNumber(draft);
    setNumberError(to === null ? "Enter a US number: 10 digits, with or without +1. Other countries, toll-free and premium numbers cannot be called." : null);
    const deskCode = code.trim();
    const codeMissing = codeRequired && deskCode === "";
    setCodeError(codeMissing ? "Enter the desk code from the LOKA Pay table." : null);
    if (to === null || codeMissing) return null;
    return codeRequired ? { to, lang, code: deskCode } : { to, lang };
  }

  function callNow() {
    const body = readForm();
    if (body !== null) void postCall(body, setPhase);
  }

  function arm() {
    const body = readForm();
    if (body === null) return;
    setConnection({ kind: "connecting" });
    setPhase({ kind: "waiting", sinceMs: Date.now() });
    setWatch(body);
  }

  function disarm() {
    setWatch(null);
    setPhase({ kind: "idle" });
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="call-form-title" className={`${CARD} flex flex-col gap-5`}>
        <h2 id="call-form-title" className="text-3xl">
          Your number
        </h2>
        <div className="grid min-w-0 gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={numberId} className="font-bold">
              US phone number
            </label>
            <input
              id={numberId}
              type="tel"
              inputMode="tel"
              autoComplete="off"
              spellCheck={false}
              placeholder="+1 and 10 digits"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={watch !== null}
              aria-describedby={numberHelpId}
              aria-invalid={numberError !== null}
              className={`${FIELD} font-mono`}
            />
            <p id={numberHelpId} className={numberError ? "text-sm font-bold" : "text-sm text-muted"} data-testid="number-help">
              {numberError ?? "US numbers (+1) only."}
            </p>
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={langId} className="font-bold">
              Language
            </label>
            <select
              id={langId}
              value={lang}
              onChange={(e) => setLang(LANGS.find((l) => l === e.target.value) ?? "en")}
              disabled={watch !== null}
              className={FIELD}
            >
              {LANGS.map((l) => (
                <option key={l} value={l} lang={LANG_OPTION[l].lang}>
                  {LANG_OPTION[l].label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {codeRequired ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={codeId} className="font-bold">
              Desk code (from the LOKA Pay table)
            </label>
            <input
              id={codeId}
              type="text"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              disabled={watch !== null}
              maxLength={64}
              aria-describedby={codeHelpId}
              aria-invalid={codeError !== null}
              className={`${FIELD} font-mono`}
            />
            <p id={codeHelpId} className={codeError ? "text-sm font-bold" : "text-sm text-muted"} data-testid="code-help">
              {codeError ?? "Calls need the code we give out at the table, so our number cannot be used to ring anyone."}
            </p>
          </div>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button type="button" onClick={callNow} disabled={!enabled || busy} className={`${BUTTON_PRIMARY} disabled:opacity-50`}>
            Call me now about the latest settled payment
          </button>
          {watch === null ? (
            <button type="button" onClick={arm} disabled={!enabled || busy} className={`${BUTTON_SECONDARY} disabled:opacity-50`}>
              Call me when the next payment settles
            </button>
          ) : (
            <button type="button" onClick={disarm} className={BUTTON_SECONDARY}>
              Stop waiting
            </button>
          )}
        </div>
      </section>

      <section aria-label="Call status" role="status" aria-live="polite" className={`${CARD} flex flex-col gap-3`} data-testid="call-state" data-state={phase.kind}>
        <PhaseView phase={phase} connection={connection} />
      </section>
    </div>
  );
}

function PhaseView({ phase, connection }: { phase: Phase; connection: Connection }) {
  switch (phase.kind) {
    case "idle":
      return <p className="text-muted">Nothing sent yet. Your number stays in this browser until you press a button.</p>;
    case "sending":
      return (
        <>
          <StateChip state="pending" label="Sending" />
          <p>Asking our server to find the payment and place the call.</p>
        </>
      );
    case "waiting":
      return (
        <>
          <StateChip state="pending" label="Waiting" />
          <p>
            Waiting for the next payment to settle, since <When ms={phase.sinceMs} />. Leave this page open: your browser is
            watching the program on Solana devnet ({connectionWords(connection)}). Your number has not been sent.
          </p>
        </>
      );
    case "calling":
      return (
        <>
          <OutlineChip label="Calling" Icon={PhoneIcon} size="lg" />
          <p className="text-xl font-bold" data-testid="call-amount">
            Calling your phone now about {formatUnits(phase.payment.amountUnits)} sandbox USDC, settled{" "}
            <When ms={phase.payment.settledAtMs} />.
          </p>
          <span className="flex min-w-0 flex-col gap-1">
            <OutLink href={phase.payment.explorer} testId="call-explorer">
              Open the payment on Solana Explorer
            </OutLink>
            <Mono>{phase.payment.signature}</Mono>
          </span>
        </>
      );
    case "rate_limited":
      return (
        <>
          <StateChip state="warning" label="Rate limited" />
          {phase.limit === "payment" ? (
            <p>This number already had a call about this payment. To hear another, use the button for the next payment.</p>
          ) : (
            <p>
              {phase.limit === "site" ? "The site has placed as many calls as it allows this hour." : "This number has had as many calls as it allows for now."}{" "}
              Try again in {waitWords(phase.retryAfterSeconds)}.
            </p>
          )}
        </>
      );
    case "no_payment":
      return (
        <>
          <StateChip state="warning" label="No settled payment yet" />
          <p>Devnet shows no settled LOKA Pay payment to read out yet. Try the button for the next payment.</p>
        </>
      );
    case "too_old":
      return (
        <>
          <StateChip state="warning" label="Too old" />
          <p>That payment settled more than {SIGNATURE_MAX_AGE_MS / 60_000} minutes ago, so no call was placed.</p>
        </>
      );
    case "wrong_code":
      return (
        <>
          <StateChip state="warning" label="Wrong desk code" />
          <p>That desk code is not right, so no call was placed. Ask at the LOKA Pay table for the code.</p>
        </>
      );
    case "off":
      return (
        <>
          <StateChip state="warning" label="Calling is off" />
          <p>Phone calls are turned off on this site right now. Nothing was sent.</p>
        </>
      );
    case "failed":
      return (
        <>
          <StateChip state="failed" label="Failed" />
          <p className="break-words">The request did not complete: {phase.reason}.</p>
        </>
      );
  }
}
