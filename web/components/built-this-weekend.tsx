// "Built this weekend" (PLAN.md 3.60): the repository's history since the pre-event kit
// tag, from GitHub's compare API (lib/github.ts). When the read fails or GitHub's limit
// for requests without a token is used up, only the link is shown, with the reason.

import type { Read } from "@/lib/cached-read";
import { HACKING_STARTED, KIT_TAG } from "@/lib/facts";
import { COMPARE_PAGE_URL, type BuiltThisWeekend } from "@/lib/github";
import { CARD, OutLink, ReadFailure, ReadStamp, When } from "./judge-ui";

function Stat({ label, testId, wide, children }: { label: string; testId: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 rounded-xl border-2 border-ink bg-paper p-4 ${wide ? "col-span-2 lg:col-span-1" : ""}`}>
      <dt className="text-sm font-bold text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-display text-2xl font-extrabold tracking-display" data-testid={testId}>
        {children}
      </dd>
    </div>
  );
}

export function BuiltThisWeekendPanel({ read }: { read: Read<BuiltThisWeekend> }) {
  return (
    <section aria-labelledby="built-title" className="flex flex-col gap-4" data-testid="built-this-weekend">
      <div className="flex flex-col gap-1">
        <h2 id="built-title" className="text-3xl">
          Built this weekend
        </h2>
        <p className="text-muted" data-testid="built-label">
          Commits on main {HACKING_STARTED} (after the <code className="font-mono text-sm">{KIT_TAG}</code> tag).
        </p>
      </div>
      {!read.ok ? (
        <ReadFailure what="the commit count from GitHub" reason={read.reason} ms={read.atMs} testId="built-unavailable" />
      ) : read.staleBecause ? (
        // PLAN.md 3.60: never a stale count. The latest read failed, so its reason is shown
        // and the older numbers are not, only the time of that older read.
        <>
          <ReadFailure what="the commit count from GitHub" reason={read.staleBecause.reason} ms={read.staleBecause.atMs} testId="built-unavailable" />
          <p className="text-sm text-muted" data-testid="built-last-good">
            An earlier read, at <When ms={read.readAtMs} />, succeeded. Its numbers are not shown because they may be
            out of date.
          </p>
        </>
      ) : (
        <Numbers b={read.data} readAtMs={read.readAtMs} />
      )}
      <OutLink href={COMPARE_PAGE_URL} testId="compare-link">
        Every commit and file on GitHub ({KIT_TAG}...main)
      </OutLink>
    </section>
  );
}

function Numbers({ b, readAtMs }: { b: BuiltThisWeekend; readAtMs: number }) {
  const partial = b.listedCommits < b.totalCommits;
  return (
    <div className={`${CARD} flex flex-col gap-4`}>
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Commits" testId="built-commits">
          {b.totalCommits.toLocaleString("en-US")}
        </Stat>
        <Stat label={partial ? `Authors (among ${b.listedCommits} listed commits)` : "Authors"} testId="built-authors">
          {b.authors.length}
        </Stat>
        <Stat label={b.filesCapped ? "Files changed (GitHub lists at most 300)" : "Files changed"} testId="built-files">
          {b.filesCapped ? `${b.filesChanged}+` : b.filesChanged.toLocaleString("en-US")}
        </Stat>
        <Stat label={b.filesCapped ? "Lines added (in the listed files)" : "Lines added"} testId="built-additions">
          {b.additions.toLocaleString("en-US")}
        </Stat>
        <Stat label="First commit" testId="built-first" wide>
          {b.firstCommitMs !== null ? <When ms={b.firstCommitMs} /> : <span className="text-base">Not shown: list cut short</span>}
        </Stat>
        <Stat label="Latest commit" testId="built-latest" wide>
          {b.latestCommitMs !== null ? <When ms={b.latestCommitMs} /> : <span className="text-base">Not shown: list cut short</span>}
        </Stat>
      </dl>
      <p className="text-sm" data-testid="built-logins">
        GitHub logins: {b.authors.length > 0 ? b.authors.join(", ") : "none linked"}
        {b.commitsWithoutLogin > 0 ? `, plus ${b.commitsWithoutLogin} commits with no linked login` : ""}.
        {partial ? ` GitHub listed ${b.listedCommits} of the ${b.totalCommits} commits.` : ""}
      </p>
      {/* Numbers is shown only for the latest read (stale reads are handled above). */}
      <ReadStamp source="GitHub's API (refreshed at most every 5 minutes)" ms={readAtMs} stale={null} testId="built-read-stamp" />
    </div>
  );
}
