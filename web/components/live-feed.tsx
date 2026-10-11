"use client";

// /live (PLAN.md 3.72): the program's transactions, read by this browser straight from
// Solana devnet. The engine (history, WebSocket, reconnects) is lib/program-feed.ts; this
// component only shows its state. No server of ours is involved, so the feed works before
// the settlement server exists and keeps working if it goes down. Nothing here is invented
// while a read is pending or failed.
//
// At the judge desk (PLAN.md 3.84): a failed row says its error code in words before its details
// arrive, and is named (SerialUsed) only once they show the failing instruction is the program's
// own (lib/live-desk.ts), never shown as raw JSON; rows docs/FACTS.json records carry their label
// (lib/row-labels.ts, built on the server); and the kiosk (/live?kiosk=1) leads with a large "Last
// payment" line, the newest redeem_note this page has read that settled or that the program refused.

import { useEffect, useRef, useState } from "react";
import {
  HISTORY_LIMIT,
  INITIAL_FEED_STATE,
  MAX_ATTEMPTS,
  ProgramFeed,
  STALL_AFTER_MS,
  type Connection,
  type History,
  type Row,
} from "@/lib/program-feed";
import { failureOf, failureWords, lastPayment, shortSignature, type LastPayment } from "@/lib/live-desk";
import type { RowLabel } from "@/lib/row-labels";
import { RPC_URL, WS_URL, explorerTx } from "@/lib/solana";
import { formatUnits } from "@/lib/vault";
import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, CheckIcon, CircleIcon, ClockIcon } from "./icons";
import { BUTTON_SECONDARY, Mono, OutLink, TxStatusChip, When } from "./judge-ui";

export function LiveFeed({
  programId,
  kiosk,
  labels = {},
}: {
  programId: string;
  kiosk: boolean;
  /** Labels for the rows docs/FACTS.json records, by signature (lib/row-labels.ts). */
  labels?: Record<string, RowLabel>;
}) {
  const [state, setState] = useState(INITIAL_FEED_STATE);
  const feed = useRef<ProgramFeed | null>(null);

  useEffect(() => {
    const current = new ProgramFeed(programId);
    feed.current = current;
    const unsubscribe = current.subscribe(setState);
    current.start();
    return () => {
      unsubscribe();
      current.stop();
      feed.current = null;
    };
  }, [programId]);

  const { rows: sorted, history, connection, lastEventMs, announcement } = state;
  const text = kiosk ? "text-xl" : "";

  return (
    <div className={`flex min-w-0 flex-col gap-6 ${text}`}>
      {kiosk ? <LastPaymentLine last={lastPayment(sorted)} history={history} labels={labels} /> : null}
      <section aria-label="Connection" className="flex min-w-0 flex-col gap-2 rounded-card border-3 border-ink bg-surface p-5 shadow-hard">
        <div className="flex flex-wrap items-center gap-3" role="status" data-testid="connection" data-state={connection.kind}>
          <ConnectionChip connection={connection} kiosk={kiosk} />
          <span className="text-sm text-muted">
            {connection.kind === "connecting" && <>Opening a WebSocket to {new URL(WS_URL).host}.</>}
            {connection.kind === "live" && (
              <>
                Subscribed to the program&apos;s logs since <When ms={connection.sinceMs} />.
              </>
            )}
            {connection.kind === "stalled" && (
              <>
                Nothing has arrived on the WebSocket for {silentSeconds(connection.silentMs)} s, though devnet sends a new slot
                more than once a second. Live needs a message at least every {STALL_AFTER_MS / 1000} s; it returns when traffic
                does.
              </>
            )}
            {connection.kind === "reconnecting" && (
              <>
                The connection closed. Attempt {connection.attempt} of {MAX_ATTEMPTS} in {Math.round(connection.retryInMs / 1000)} s.
              </>
            )}
            {connection.kind === "failed" && <>Stopped: {connection.reason}.</>}
          </span>
          {connection.kind === "failed" ? (
            <button type="button" onClick={() => feed.current?.retry()} className={BUTTON_SECONDARY}>
              Try again
            </button>
          ) : null}
        </div>
        <p className="text-sm" data-testid="last-event">
          Last new transaction:{" "}
          {lastEventMs === null ? <span className="text-muted">none since this page opened</span> : <When ms={lastEventMs} />}
        </p>
        <p className="text-sm text-muted">
          Reading {new URL(RPC_URL).host} directly from this browser.
        </p>
      </section>

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <section aria-labelledby="tx-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="tx-title" className={kiosk ? "text-4xl" : "text-3xl"}>
            Transactions, newest first
          </h2>
          <HistoryLine history={history} />
        </div>
        {sorted.length === 0 ? <EmptyFeed history={history} /> : null}
        <ul className="flex flex-col gap-4" data-testid="tx-list">
          {sorted.map((row) => (
            <TxRow key={row.signature} row={row} kiosk={kiosk} label={labels[row.signature]} />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ConnectionChip({ connection, kiosk }: { connection: Connection; kiosk: boolean }) {
  const size = kiosk ? "lg" : "md";
  switch (connection.kind) {
    case "live":
      return <StateChip state="paid" label="Live" size={size} />;
    case "stalled":
      return <StateChip state="warning" label={`No update for ${silentSeconds(connection.silentMs)} s`} size={size} />;
    case "connecting":
      return <StateChip state="pending" label="Connecting" size={size} />;
    case "reconnecting":
      return <StateChip state="pending" label="Reconnecting" size={size} />;
    case "failed":
      return <StateChip state="failed" label="Not connected" size={size} />;
  }
}

function silentSeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

function HistoryLine({ history }: { history: History }) {
  if (history.kind === "loading") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted" data-testid="history-state" data-state="loading">
        <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Reading the latest {HISTORY_LIMIT} transactions from devnet.</span>
      </p>
    );
  }
  if (history.kind === "failed") {
    return (
      <p className="flex items-start gap-2 text-sm font-bold" data-testid="history-state" data-state="failed">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Could not read the latest transactions at <When ms={history.atMs} />: {history.reason}. New ones still appear
          below while the connection is live.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid="history-state" data-state="ok">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Latest {history.count} read from devnet at <When ms={history.atMs} />.
      </span>
    </p>
  );
}

/** What an empty list is waiting for, said plainly on the first paint and after. */
function EmptyFeed({ history }: { history: History }) {
  return (
    <p className="rounded-card border-2 border-dashed border-ink p-5" data-testid="tx-empty" data-state={history.kind}>
      {history.kind === "loading" && (
        <>
          Waiting for devnet: this browser is reading the program&apos;s latest {HISTORY_LIMIT} transactions from{" "}
          {new URL(RPC_URL).host}. They appear here, newest first, as soon as devnet answers, and each new one is added as
          it lands.
        </>
      )}
      {history.kind === "failed" && (
        <>Nothing to show yet: the latest transactions could not be read (see above). A new one still appears here while the connection is live.</>
      )}
      {history.kind === "ok" && <>No transactions for this program yet. A new one appears here as it lands.</>}
    </p>
  );
}

/** The kiosk's headline: the newest payment this page has read, in type a judge reads from across a table. */
function LastPaymentLine({ last, history, labels }: { last: LastPayment; history: History; labels: Record<string, RowLabel> }) {
  const state =
    last.kind === "none" ? (history.kind === "loading" || last.reading > 0 ? "waiting" : last.unread > 0 ? "unread" : "none") : last.kind;
  return (
    <section
      aria-labelledby="last-payment-title"
      className="flex min-w-0 flex-col gap-3 rounded-card border-3 border-ink bg-surface p-6 shadow-hard-lg"
      data-testid="last-payment"
      data-state={state}
      data-signature={last.kind === "none" ? undefined : last.row.signature}
    >
      <h2 id="last-payment-title" className="text-3xl">
        Last payment
      </h2>
      {last.kind === "none" ? (
        <p className="text-3xl leading-snug" data-testid="last-payment-headline">
          {history.kind === "loading"
            ? `Waiting for devnet: reading the program's latest ${HISTORY_LIMIT} transactions to find the last payment.`
            : history.kind === "failed"
              ? "Could not read the latest transactions yet. A new payment still appears here while the connection is live."
              : last.reading > 0
                ? `Reading ${last.reading} transaction${last.reading === 1 ? "" : "s"} from devnet to find the last payment.${
                    last.unread > 0 ? ` ${last.unread} more could not be read.` : ""
                  }`
                : last.unread > 0
                  ? `No payment found among the transactions read. ${last.unread} transaction${last.unread === 1 ? "" : "s"} could not be read from devnet, and the last payment may be ${last.unread === 1 ? "that one" : "one of them"}.`
                  : `No payment among the latest ${HISTORY_LIMIT} transactions. The next one appears here as soon as it lands.`}
        </p>
      ) : (
        <LastPaymentBody last={last} label={labels[last.row.signature]} />
      )}
    </section>
  );
}

function LastPaymentBody({ last, label }: { last: Exclude<LastPayment, { kind: "none" }>; label: RowLabel | undefined }) {
  const { row } = last;
  return (
    <>
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        {last.kind === "paid" ? <StateChip state="paid" label="Paid" size="lg" testId="last-payment-status" /> : null}
        {last.kind === "refused" ? <StateChip state="failed" label="Refused" size="lg" testId="last-payment-status" /> : null}
        {last.kind === "unknown" ? <StateChip state="warning" label="Result unknown" size="lg" testId="last-payment-status" /> : null}
        {row.arrivedLive ? <OutlineChip label="New" Icon={CircleIcon} size="lg" testId="last-payment-new" /> : null}
        {label ? <OutlineChip label={label.chip} Icon={CheckIcon} size="lg" testId="last-payment-label" /> : null}
      </div>
      <p className="font-display text-5xl font-extrabold leading-tight tracking-tight break-words sm:text-6xl" data-testid="last-payment-headline">
        {last.kind === "paid" && (last.amountUnits ? `Paid ${formatUnits(last.amountUnits)} sandbox USDC` : "Paid")}
        {last.kind === "refused" &&
          (last.failure.kind === "program" ? `Refused: ${last.failure.error.name} (${last.failure.error.number})` : "Refused on chain")}
        {last.kind === "unknown" && "Result unknown: devnet did not say whether it settled"}
      </p>
      {last.kind === "refused" ? (
        <p className="text-2xl break-words" data-testid="last-payment-reason">
          {last.failure.kind === "program" ? `${last.failure.error.message}. No money moved.` : `${last.failure.words} No money moved.`}
        </p>
      ) : null}
      <p className="text-2xl" data-testid="last-payment-when">
        {row.blockTime !== null ? <When ms={row.blockTime * 1000} /> : row.seenAtMs !== null ? <When ms={row.seenAtMs} /> : "Time not read yet"}
        <span className="text-muted">
          {" "}
          · tx <span className="font-mono">{shortSignature(row.signature)}</span>
        </span>
      </p>
      {last.newerUnread > 0 ? (
        <p className="flex items-start gap-2 text-2xl font-bold" data-testid="last-payment-unread">
          <AlertIcon className="mt-1 h-6 w-6 shrink-0" />
          <span>
            {last.newerUnread} newer transaction{last.newerUnread === 1 ? "" : "s"} could not be read from devnet, so the last payment may
            be newer than this one.
          </span>
        </p>
      ) : null}
      {last.newerReading > 0 ? (
        <p className="text-base text-muted" data-testid="last-payment-newer">
          {last.newerReading} newer transaction{last.newerReading === 1 ? " is" : "s are"} still being read from devnet.
        </p>
      ) : null}
    </>
  );
}

function TxRow({ row, kiosk, label }: { row: Row; kiosk: boolean; label: RowLabel | undefined }) {
  const title = row.actions.length > 0 ? row.actions.join(", ") : null;
  const failure = failureOf(row);
  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-card border-3 border-ink bg-surface p-5 shadow-hard"
      data-testid="tx-row"
      data-signature={row.signature}
      data-details={row.details}
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className={kiosk ? "text-3xl" : "text-xl"} data-testid="tx-action">
          {title ? (
            <code className="break-all font-mono font-bold">{title}</code>
          ) : row.details === "reading" ? (
            <span className="text-muted">Reading details</span>
          ) : row.details === "read" ? (
            <span className="text-muted">No loka_vault instruction in its logs</span>
          ) : row.details === "unavailable" ? (
            <span className="text-muted">Details unavailable: devnet&apos;s answer could not be read</span>
          ) : (
            <span className="text-muted">Details not read</span>
          )}
        </h3>
        <span className="flex flex-wrap items-center gap-2">
          {label ? <OutlineChip label={label.chip} Icon={CheckIcon} testId="tx-label" /> : null}
          {row.arrivedLive ? <OutlineChip label="New" Icon={CircleIcon} testId="tx-new" /> : null}
          <TxStatusChip result={row.result} errorName={failure?.kind === "program" ? failure.error.name : null} />
        </span>
      </div>
      {label ? (
        <p className="text-sm text-muted" data-testid="tx-label-detail">
          {label.detail}
        </p>
      ) : null}
      {/* Amounts only for a transaction known to have succeeded (lib/logs.ts). */}
      {row.result === "succeeded" && row.amounts.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="tx-amounts">
          {row.amounts.map((a, i) => (
            <li key={i} className="font-bold">
              {a.label}: {formatUnits(a.units)} <span className="font-medium text-muted">sandbox USDC</span>
            </li>
          ))}
        </ul>
      ) : null}
      {failure ? (
        <p className="break-words text-sm" data-testid="tx-error">
          {failureWords(failure)}
        </p>
      ) : null}
      {row.result === "unknown" ? (
        <p className="break-words text-sm" data-testid="tx-result-unknown">
          Devnet&apos;s answer did not say whether this transaction succeeded, so no amount is shown.
        </p>
      ) : null}
      <p className="text-sm">
        {row.blockTime !== null ? (
          <When ms={row.blockTime * 1000} />
        ) : row.seenAtMs !== null ? (
          <>
            Seen <When ms={row.seenAtMs} /> <span className="text-muted">(block time not read yet)</span>
          </>
        ) : (
          <span className="text-muted">Block time not read</span>
        )}
        {row.slot !== null ? <span className="text-muted">, slot {row.slot}</span> : null}
      </p>
      <span className="flex min-w-0 flex-col gap-1">
        <OutLink href={explorerTx(row.signature)} testId="tx-explorer">
          Open on Solana Explorer
        </OutLink>
        <Mono>{row.signature}</Mono>
      </span>
    </li>
  );
}
