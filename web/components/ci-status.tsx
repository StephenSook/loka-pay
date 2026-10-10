// The result of each GitHub Actions workflow on main's latest commit, read by this site's
// server from GitHub's check runs API (lib/github.ts readMainChecks), so a visitor's browser
// sends nothing to GitHub. Replaces GitHub's hotlinked badge images. Server component.

import type { Read } from "@/lib/cached-read";
import { REPO_URL } from "@/lib/site";
import { WORKFLOWS, type CheckRun, type MainChecks } from "@/lib/github";
import { OutlineChip, StateChip } from "./chips";
import { CheckIcon, CircleIcon } from "./icons";
import { OutLink, ReadFailure, ReadStamp } from "./judge-ui";

/** The result word for a job, and the data-result value the tests read. */
function resultOf(run: CheckRun | undefined): { result: string; chip: React.ReactNode } {
  if (!run) return { result: "missing", chip: <OutlineChip label="No run on this commit" Icon={CircleIcon} testId="ci-result" /> };
  if (run.status !== "completed") {
    const word = run.status === "queued" ? "Queued" : "Running";
    return { result: run.status, chip: <StateChip state="pending" label={word} testId="ci-result" /> };
  }
  if (run.conclusion === "success") return { result: "success", chip: <OutlineChip label="Passed" Icon={CheckIcon} testId="ci-result" /> };
  const words: Record<string, string> = { failure: "Failed", cancelled: "Cancelled", timed_out: "Timed out", skipped: "Skipped" };
  const conclusion = run.conclusion ?? "unknown";
  const word = words[conclusion] ?? `Ended: ${conclusion}`;
  return { result: conclusion, chip: <StateChip state={conclusion === "skipped" ? "warning" : "failed"} label={word} testId="ci-result" /> };
}

export function CiStatusList({ read }: { read: Read<MainChecks> }) {
  const checks = read.ok ? read.data : null;
  const commit = checks?.sha ? checks.sha.slice(0, 7) : null;
  const stamp = read.ok ? (
    <ReadStamp
      source="GitHub's API"
      slot={commit ? `main's latest commit ${commit}` : "main's latest commit"}
      ms={read.readAtMs}
      stale={read.staleBecause}
      current={read.current}
      askedAtMs={read.askedAtMs}
      testId="ci-read-stamp"
    />
  ) : null;
  const serverRun = checks?.runs.find((r) => r.name === WORKFLOWS.find((w) => w.file === "server")?.job);
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {!read.ok ? <ReadFailure what="the workflow results from GitHub" reason={read.reason} ms={read.atMs} testId="ci-read-failure" /> : null}
      {/* Values from an older read are introduced as such, before any of them. */}
      {read.ok && read.staleBecause ? stamp : null}
      <ul className="flex flex-col gap-3" aria-label="GitHub Actions workflows">
        {WORKFLOWS.map((w) => {
          const run = checks?.runs.find((r) => r.name === w.job);
          const shown = checks ? resultOf(run) : null;
          return (
            <li key={w.file} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1" data-testid={`ci-${w.file}`} data-result={shown?.result ?? "not-read"}>
              {shown?.chip}
              <OutLink href={run?.htmlUrl ?? `${REPO_URL}/actions/workflows/${w.file}.yml`}>{w.job}</OutLink>
            </li>
          );
        })}
      </ul>
      {serverRun && !(serverRun.status === "completed" && serverRun.conclusion === "success") ? (
        <p className="text-sm text-muted" data-testid="server-workflow-note">
          The server workflow tests the settlement server in server/, so it does not pass until that code is merged into main.
        </p>
      ) : null}
      {read.ok && read.staleBecause ? null : stamp}
    </div>
  );
}
