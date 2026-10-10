// Building blocks shared by /judge, /live, /proof and /trust, in the site's paper and ink
// style. Every state is a word AND an icon. No hooks, so server and client pages both use them.

import { OutlineChip, StateChip } from "./chips";
import { AlertIcon, ArrowUpRightIcon, CheckIcon, CircleIcon, ClockIcon } from "./icons";
import type { ClaimStatus } from "@/lib/claims";
import type { TxResult } from "@/lib/logs";
import type { FailedRead } from "@/lib/read-state";
import { formatAge, formatEt, isoUtc } from "@/lib/time";

export const CARD = "min-w-0 rounded-card border-3 border-ink bg-surface p-5 shadow-hard";
export const PAGE = "mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-10 sm:px-6 sm:py-16";
export const BUTTON_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-full border-3 border-ink bg-ink px-6 py-3 font-bold text-paper shadow-hard transition-transform motion-safe:hover:-translate-y-0.5";
export const BUTTON_SECONDARY =
  "inline-flex items-center justify-center gap-2 rounded-full border-3 border-ink bg-surface px-6 py-3 font-bold text-ink shadow-hard transition-transform motion-safe:hover:-translate-y-0.5";

/** A time, shown in Atlanta time, with the exact instant in the dateTime attribute. */
export function When({ ms }: { ms: number }) {
  return <time dateTime={isoUtc(ms)}>{formatEt(ms)}</time>;
}

export function Mono({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <span data-testid={testId} className="break-all font-mono text-sm">
      {children}
    </span>
  );
}

/** A link that opens another site in a new tab, with the arrow every outside link carries. */
export function OutLink({ href, children, testId }: { href: string; children: React.ReactNode; testId?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      data-testid={testId}
      className="font-bold underline"
    >
      {children}
      <ArrowUpRightIcon className="ml-1 inline-block h-4 w-4 align-[-0.15em]" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

/** One labelled value in a list of facts (a <dl>). */
export function Fact({ label, testId, children }: { label: string; testId?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1 border-t-2 border-ink/15 pt-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="font-bold">{label}</dt>
      <dd className="min-w-0" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

/** "Yes" or "No" with an icon, for a check the page ran against chain data. */
export function YesNo({ value, yes = "Yes", no = "No", testId }: { value: boolean; yes?: string; no?: string; testId?: string }) {
  return value ? (
    <OutlineChip label={yes} Icon={CheckIcon} testId={testId} />
  ) : (
    <StateChip state="warning" label={no} testId={testId} />
  );
}

/**
 * Where and when a value was read: the slot, the time and its exact age, and whether it is
 * current (younger than its read's window, lib/read-state.ts) or a cached read. `stale` is
 * required so every page that stamps a cached read decides what to show when the latest read
 * failed or was not made: then the stamp becomes a warning that names the last good read, its
 * age, and the read that failed and why.
 */
export function ReadStamp({
  source,
  slot,
  ms,
  stale,
  current,
  shownAtMs,
  testId,
}: {
  source: string;
  slot?: string;
  ms: number;
  stale: FailedRead | null;
  current: boolean;
  shownAtMs: number;
  testId?: string;
}) {
  const age = formatAge(shownAtMs - ms);
  if (stale) {
    return (
      <div
        role="status"
        data-testid={testId}
        data-stale="true"
        data-current="false"
        className="flex min-w-0 gap-3 rounded-card border-3 border-warning-line bg-warning p-4 text-sm text-on-state"
      >
        <AlertIcon className="mt-0.5 h-5 w-5 shrink-0" />
        <p className="min-w-0 break-words">
          <strong>Not current.</strong> Last good read from {source}
          {slot ? <> at {slot}</> : null}, <When ms={ms} />, {age} old when this page loaded. The latest read, at{" "}
          <When ms={stale.atMs} />, {stale.notMade ? "was not made" : "failed"}: {stale.reason}. The values shown are
          from the last good read.
        </p>
      </div>
    );
  }
  return (
    <p className="flex items-start gap-2 text-sm text-muted" data-testid={testId} data-stale="false" data-current={current ? "true" : "false"}>
      <ClockIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">
        Read from {source}
        {slot ? <> at {slot}</> : null}, <When ms={ms} />
        {current ? <>, {age} before this page loaded.</> : <>: a cached read, {age} old when this page loaded.</>}
      </span>
    </p>
  );
}

/** A read that failed, said plainly with its time. Never replaced by an old or typed value. */
export function ReadFailure({ what, reason, ms, testId = "read-failure" }: { what: string; reason: string; ms: number; testId?: string }) {
  return (
    <div
      role="status"
      data-testid={testId}
      className="flex min-w-0 gap-3 rounded-card border-3 border-warning-line bg-warning p-5 text-on-state"
    >
      <AlertIcon className="mt-1 h-5 w-5 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-bold">Could not read {what}.</p>
        <p className="break-words text-sm">
          Tried at <When ms={ms} />: {reason}. Nothing is shown in its place. Reload the page to try again.
        </p>
      </div>
    </div>
  );
}

/** LIVE (a current read backs it), AVAILABLE (a page you run yourself), BUILDING or NOT CHECKED (lib/claims.ts). */
export function ClaimChip({ status }: { status: ClaimStatus }) {
  if (status === "live") return <StateChip state="paid" label="Live" testId="claim-status" />;
  if (status === "available") return <OutlineChip label="Available" Icon={ArrowUpRightIcon} testId="claim-status" />;
  if (status === "building") return <OutlineChip label="Building" Icon={CircleIcon} testId="claim-status" />;
  return <StateChip state="warning" label="Not checked" testId="claim-status" />;
}

/** Succeeded, Failed, or Result unknown when the node's answer did not say (lib/logs.ts TxResult). */
export function TxStatusChip({ result, errorName }: { result: TxResult; errorName?: string | null }) {
  if (result === "failed") return <StateChip state="failed" label={errorName ? `Failed: ${errorName}` : "Failed"} testId="tx-status" />;
  if (result === "unknown") return <StateChip state="warning" label="Result unknown" testId="tx-status" />;
  return <OutlineChip label="Succeeded" Icon={CheckIcon} testId="tx-status" />;
}

