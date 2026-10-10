"use client";

// /live (PLAN.md 3.72): the program's transactions, read by this browser straight from
// Solana devnet. The engine (history, WebSocket, reconnects) is lib/program-feed.ts; this
// component only shows its state. No server of ours is involved, so the feed works before
// the settlement server exists and keeps working if it goes down. Nothing here is invented
// while a read is pending or failed.

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
import { RPC_URL, WS_URL, explorerTx } from "@/lib/solana";
import { formatUnits } from "@/lib/vault";
import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, CheckIcon, CircleIcon, ClockIcon } from "./icons";
import { BUTTON_SECONDARY, Mono, OutLink, TxStatusChip, When } from "./judge-ui";

export function LiveFeed({ programId, kiosk }: { programId: string; kiosk: boolean }) {
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
        {sorted.length === 0 && history.kind === "ok" ? (
          <p className="rounded-card border-2 border-dashed border-ink p-5">No transactions for this program yet.</p>
        ) : null}
        <ul className="flex flex-col gap-4" data-testid="tx-list">
          {sorted.map((row) => (
            <TxRow key={row.signature} row={row} kiosk={kiosk} />
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

function TxRow({ row, kiosk }: { row: Row; kiosk: boolean }) {
  const title = row.actions.length > 0 ? row.actions.join(", ") : null;
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
          {row.arrivedLive ? <OutlineChip label="New" Icon={CircleIcon} testId="tx-new" /> : null}
          <TxStatusChip failed={row.failed} errorName={row.error?.name} />
        </span>
      </div>
      {/* A failed transaction moved nothing, so no amount is shown for it (lib/logs.ts). */}
      {!row.failed && row.amounts.length > 0 ? (
        <ul className="flex flex-col gap-1" data-testid="tx-amounts">
          {row.amounts.map((a, i) => (
            <li key={i} className="font-bold">
              {a.label}: {formatUnits(a.units)} <span className="font-medium text-muted">sandbox USDC</span>
            </li>
          ))}
        </ul>
      ) : null}
      {row.failed ? (
        <p className="break-words text-sm" data-testid="tx-error">
          {row.error ? `${row.error.name} (${row.error.number}): ${row.error.message}.` : `Transaction error: ${row.errText ?? "unknown"}.`}
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
