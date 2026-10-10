"use client";

// /watch (PLAN.md 3.85): one allowance, read by this browser straight from Solana devnet. The
// engine (address, polling, pacing, parsing) is lib/watch.ts; this component only shows its
// state, and tells the engine when the page is hidden so it stops reading. No server of ours
// is involved. Nothing here is invented while a read is pending or failed.

import { useEffect, useState } from "react";
import { SERIALS_PER_ALLOWANCE, type AllowanceMeter } from "@/lib/allowance-read";
import { RPC_URL, explorerAddress, explorerTx } from "@/lib/solana";
import { formatUnits } from "@/lib/vault";
import {
  AllowanceWatch,
  INITIAL_WATCH_STATE,
  POLL_MS,
  type AccountState,
  type Entry,
  type ListState,
  type Polling,
} from "@/lib/watch";
import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, CheckIcon, CircleIcon, ClockIcon } from "./icons";
import { CARD, Mono, OutLink, When } from "./judge-ui";

export function WatchPanel({ allowanceId, programId }: { allowanceId: string; programId: string }) {
  const [state, setState] = useState(INITIAL_WATCH_STATE);

  useEffect(() => {
    const watch = new AllowanceWatch(allowanceId, programId);
    const unsubscribe = watch.subscribe(setState);
    const onVisibility = () => watch.setVisible(document.visibilityState !== "hidden");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    void watch.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      unsubscribe();
      watch.stop();
    };
  }, [allowanceId, programId]);

  const { address, account, list, entries, polling, announcement } = state;
  const shown = entries.filter((e) => e.details !== "reading" && e.tx?.kind !== "other");
  const reading = entries.filter((e) => e.details === "reading").length;
  const notPayments = entries.filter((e) => e.tx?.kind === "other").length;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <Meter account={account} allowanceId={allowanceId} address={address} />

      <PollingLine polling={polling} />

      <section aria-labelledby="payments-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="payments-title" className="text-3xl">
            Payments from this allowance, newest first
          </h2>
          <ListLine list={list} reading={reading} notPayments={notPayments} />
        </div>
        {list.kind === "ok" && reading === 0 && shown.length === 0 ? (
          <p className="rounded-card border-2 border-dashed border-ink p-5" data-testid="watch-empty">
            No payments from this allowance yet. A payment shows here within about {POLL_MS / 1000} s of settling on devnet.
          </p>
        ) : null}
        <ul className="flex flex-col gap-4" data-testid="watch-list">
          {shown.map((entry) => (
            <EntryRow key={entry.signature} entry={entry} />
          ))}
        </ul>
      </section>

      <p className="text-sm text-muted">
        This page reads {new URL(RPC_URL).host} directly from this browser. Sandbox only: test tokens on Solana devnet with
        no value.
      </p>
    </div>
  );
}

function Meter({ account, allowanceId, address }: { account: AccountState; allowanceId: string; address: string | null }) {
  const read = account.kind === "ok" ? account.read : account.kind === "failed" ? (account.previous?.read ?? null) : null;
  const atMs = account.kind === "ok" ? account.atMs : account.kind === "failed" ? (account.previous?.atMs ?? null) : null;
  return (
    <section aria-labelledby="meter-title" className={`${CARD} flex min-w-0 flex-col gap-4`} data-testid="meter" data-state={account.kind}>
      <div className="flex min-w-0 flex-col gap-1">
        <h2 id="meter-title" className="text-3xl">
          Allowance meter
        </h2>
        <p className="text-sm">
          Allowance <Mono testId="meter-id">{allowanceId}</Mono>
        </p>
      </div>
      {account.kind === "loading" ? (
        <p className="flex items-start gap-2 text-muted" data-testid="meter-loading">
          <ClockIcon className="mt-1 h-4 w-4 shrink-0" />
          <span>Reading the allowance account from devnet.</span>
        </p>
      ) : null}
      {account.kind === "failed" ? (
        <p className="flex items-start gap-2 font-bold" data-testid="meter-failed">
          <AlertIcon className="mt-1 h-4 w-4 shrink-0" />
          <span>
            Could not read the allowance at <When ms={account.atMs} />: {account.reason}.
            {account.previous ? " The numbers below are the last good read, not current." : null}
          </span>
        </p>
      ) : null}
      {read?.kind === "missing" ? (
        <p className="font-bold" data-testid="meter-missing">
          Devnet has no allowance account for this id (read at slot {read.slot}). Check the id on the payer phone.
        </p>
      ) : null}
      {read?.kind === "found" && atMs !== null ? <MeterNumbers meter={read.meter} atMs={atMs} /> : null}
      {address ? (
        <p className="text-sm">
          <OutLink href={explorerAddress(address)} testId="meter-account">
            The allowance account on Solana Explorer
          </OutLink>
        </p>
      ) : null}
    </section>
  );
}

function MeterNumbers({ meter, atMs }: { meter: AllowanceMeter; atMs: number }) {
  const cap = BigInt(meter.capUnits);
  const settled = BigInt(meter.settledUnits);
  // Whole percent for the bar only; every number on the page is the exact amount.
  const percent = cap > BigInt(0) ? Math.min(100, Number((settled * BigInt(100)) / cap)) : 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="font-display text-5xl font-extrabold leading-none tracking-tight">
        <span data-testid="meter-left">{formatUnits(meter.leftUnits)}</span>{" "}
        <span className="font-body text-xl font-bold tracking-normal">sandbox USDC left</span>
      </p>
      <div
        role="progressbar"
        aria-label="Settled so far, as a share of the cap"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="h-5 w-full overflow-hidden rounded-full border-3 border-ink bg-surface"
      >
        <div className="h-full bg-paid-strong" style={{ width: `${percent}%` }} />
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-3">
        <MeterFact label="Cap" testId="meter-cap" value={formatUnits(meter.capUnits)} unit="sandbox USDC" />
        <MeterFact label="Settled so far" testId="meter-settled" value={formatUnits(meter.settledUnits)} unit="sandbox USDC" />
        <MeterFact label="Serials used" testId="meter-serials" value={`${meter.serialsUsed} of ${SERIALS_PER_ALLOWANCE}`} unit="" />
        <MeterFact label="Offline limit" testId="meter-offline" value={formatUnits(meter.offlineLimitUnits)} unit="sandbox USDC per note" />
      </dl>
      {meter.overCap ? (
        <p className="font-bold" data-testid="meter-over-cap">
          The account says more was settled than its cap, which the program forbids; this page shows it as read.
        </p>
      ) : null}
      <p className="text-sm">
        Expires <When ms={meter.expiry * 1000} />.
      </p>
      <p className="text-sm text-muted" data-testid="meter-read">
        Read from Solana devnet by this browser at <When ms={atMs} />, slot {meter.slot}.
      </p>
    </div>
  );
}

function MeterFact({ label, value, unit, testId }: { label: string; value: string; unit: string; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 border-t-2 border-ink/15 pt-2">
      <dt className="text-sm font-bold text-muted">{label}</dt>
      <dd className="min-w-0">
        <span className="text-2xl font-bold" data-testid={testId}>
          {value}
        </span>
        {unit ? <span className="block text-sm text-muted">{unit}</span> : null}
      </dd>
    </div>
  );
}

function PollingLine({ polling }: { polling: Polling }) {
  return (
    <p className="flex items-start gap-2 text-sm" role="status" data-testid="watch-polling" data-state={polling.kind}>
      {polling.kind === "failed" ? <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {polling.kind === "starting" && "Finding the allowance account on devnet."}
        {polling.kind === "running" && `Reading devnet every ${POLL_MS / 1000} s while this page is open.`}
        {polling.kind === "paused" && "Paused while this page is hidden. It reads devnet again as soon as you come back."}
        {polling.kind === "rate-limited" && (
          <>
            Devnet is rate limiting this connection, so this page waits. It reads again at <When ms={polling.untilMs} />.
          </>
        )}
        {polling.kind === "failed" && <>Stopped: {polling.reason}.</>}
      </span>
    </p>
  );
}

function ListLine({ list, reading, notPayments }: { list: ListState; reading: number; notPayments: number }) {
  if (list.kind === "loading") {
    return (
      <p className="flex items-start gap-2 text-sm text-muted" data-testid="watch-list-state" data-state="loading">
        <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Reading this allowance&apos;s transactions from devnet.</span>
      </p>
    );
  }
  if (list.kind === "failed") {
    return (
      <p className="flex items-start gap-2 text-sm font-bold" data-testid="watch-list-state" data-state="failed">
        <AlertIcon className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Could not read this allowance&apos;s transactions at <When ms={list.atMs} />: {list.reason}. It tries again on the next
          read.
        </span>
      </p>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid="watch-list-state" data-state="ok">
      <CheckIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        Latest {list.count} transactions on this allowance read at <When ms={list.atMs} />
        {reading > 0 ? `; reading ${reading} of them from devnet` : ""}.
        {notPayments > 0
          ? ` ${notPayments === 1 ? "One is" : `${notPayments} are`} not a payment (such as the transaction that opened the allowance), so not listed.`
          : ""}
      </span>
    </p>
  );
}

function EntryRow({ entry }: { entry: Entry }) {
  const tx = entry.tx;
  const kind = entry.details === "read" && tx ? tx.kind : entry.details;
  return (
    <li
      className={`${CARD} flex min-w-0 flex-col gap-2`}
      data-testid="watch-row"
      data-signature={entry.signature}
      data-kind={kind}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        {tx?.kind === "paid" ? <StateChip state="paid" label="Paid" size="lg" testId="watch-status" /> : null}
        {tx?.kind === "refused" ? <StateChip state="failed" label="Refused" size="lg" testId="watch-status" /> : null}
        {tx?.kind === "unknown" ? <StateChip state="warning" label="Result unknown" size="lg" testId="watch-status" /> : null}
        {entry.details === "unread" || entry.details === "unavailable" ? (
          <OutlineChip label="Details not read" Icon={AlertIcon} size="lg" testId="watch-status" />
        ) : null}
        {entry.arrivedWhileWatching ? <OutlineChip label="New" Icon={CircleIcon} testId="watch-new" /> : null}
      </div>
      {tx?.kind === "paid" ? (
        <p className="text-2xl font-bold" data-testid="watch-headline">
          {tx.amountUnits ? (
            <>
              Paid {formatUnits(tx.amountUnits)} <span className="text-lg text-muted">sandbox USDC</span>
            </>
          ) : (
            "Paid: settled on devnet (its logs carry no amount for this allowance)"
          )}
        </p>
      ) : null}
      {tx?.kind === "paid" && tx.serial !== null ? <p data-testid="watch-serial">Serial {tx.serial}</p> : null}
      {tx?.kind === "refused" ? (
        <>
          <p className="text-2xl font-bold break-words" data-testid="watch-headline">
            {tx.error ? `Refused: ${tx.error.name} (${tx.error.number})` : "Refused on chain"}
          </p>
          <p className="break-words" data-testid="watch-reason">
            {tx.error ? `${tx.error.message}. No money moved.` : `${tx.errorWords} No money moved.`}
          </p>
        </>
      ) : null}
      {tx?.kind === "unknown" ? (
        <p className="break-words" data-testid="watch-headline">
          Devnet&apos;s answer did not say whether this payment settled, so no amount is shown.
        </p>
      ) : null}
      {entry.details === "unread" || entry.details === "unavailable" ? (
        <p className="break-words" data-testid="watch-headline">
          {entry.details === "unread"
            ? "Devnet did not answer for this transaction's details; open it on the explorer."
            : "Devnet's answer for this transaction could not be read; open it on the explorer."}
        </p>
      ) : null}
      <p className="text-sm">
        {entry.blockTime !== null ? <When ms={entry.blockTime * 1000} /> : <span className="text-muted">Block time not read</span>}
        <span className="text-muted">, slot {entry.slot}</span>
        {tx?.feeLamports !== null && tx?.feeLamports !== undefined ? (
          <span className="text-muted">, network fee {tx.feeLamports.toLocaleString("en-US")} lamports</span>
        ) : null}
      </p>
      <span className="flex min-w-0 flex-col gap-1">
        <OutLink href={explorerTx(entry.signature)} testId="watch-explorer">
          Open on Solana Explorer
        </OutLink>
        <Mono>{entry.signature}</Mono>
      </span>
    </li>
  );
}
