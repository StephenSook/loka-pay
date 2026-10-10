// "Built this weekend" (PLAN.md 3.60): what changed in the repository since the pre-event
// kit tag, read from GitHub's public compare API with no token, cached for 5 minutes
// (lib/cached-read.ts). A rate-limited or failed read is never replaced by an old or
// typed-in number: the page shows the compare link and says the count is unavailable.

import { cachedRead, type Read } from "./cached-read";
import { KIT_TAG } from "./facts";
import { REPO_URL } from "./site";

export const REPO = "StephenSook/loka-pay";
export const COMPARE_API_URL = `https://api.github.com/repos/${REPO}/compare/${KIT_TAG}...main`;
export const COMPARE_PAGE_URL = `${REPO_URL}/compare/${KIT_TAG}...main`;
export const REVALIDATE_SECONDS = 300;

/** GitHub lists at most this many changed files in a compare answer. */
export const FILES_CAP = 300;

export interface BuiltThisWeekend {
  totalCommits: number;
  /** Commits in the answer's list. GitHub lists up to 250 without paging. */
  listedCommits: number;
  /** Distinct GitHub logins among the listed commits, sorted. */
  authors: string[];
  /** Listed commits whose author email is not linked to a GitHub login. */
  commitsWithoutLogin: number;
  filesChanged: number;
  /** True when GitHub's file list hit its cap, so the count and additions are a floor. */
  filesCapped: boolean;
  /** Lines added, summed over the listed files. */
  additions: number;
  /** Author times of the earliest and latest listed commits; null when the list is cut short. */
  firstCommitMs: number | null;
  latestCommitMs: number | null;
}

export class GitHubError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubError";
  }
}

interface CompareCommit {
  author: { login?: unknown } | null;
  commit: { author: { date?: unknown } | null };
}

/** Reduces a compare answer to the panel's numbers. Throws GitHubError on an unexpected shape. */
export function summarizeCompare(body: unknown): BuiltThisWeekend {
  const b = body as { total_commits?: unknown; commits?: unknown; files?: unknown } | null;
  if (!b || typeof b.total_commits !== "number" || !Array.isArray(b.commits) || !Array.isArray(b.files)) {
    throw new GitHubError("GitHub's compare answer had an unexpected shape");
  }
  const commits = b.commits as CompareCommit[];
  const logins = new Set<string>();
  let withoutLogin = 0;
  const times: number[] = [];
  for (const c of commits) {
    const login = c?.author?.login;
    if (typeof login === "string" && login.length > 0) logins.add(login);
    else withoutLogin += 1;
    const date = c?.commit?.author?.date;
    const ms = typeof date === "string" ? Date.parse(date) : NaN;
    if (!Number.isNaN(ms)) times.push(ms);
  }
  const files = b.files as Array<{ additions?: unknown }>;
  let additions = 0;
  for (const f of files) if (typeof f?.additions === "number") additions += f.additions;
  // When GitHub cuts the commit list short, the listed commits are not the whole range,
  // so the earliest and latest listed times are not shown as the first and latest.
  const complete = commits.length === b.total_commits && times.length === commits.length;
  return {
    totalCommits: b.total_commits,
    listedCommits: commits.length,
    authors: [...logins].sort((x, y) => x.localeCompare(y)),
    commitsWithoutLogin: withoutLogin,
    filesChanged: files.length,
    filesCapped: files.length >= FILES_CAP,
    additions,
    firstCommitMs: complete && times.length > 0 ? Math.min(...times) : null,
    latestCommitMs: complete && times.length > 0 ? Math.max(...times) : null,
  };
}

async function readCompareUncached(): Promise<BuiltThisWeekend> {
  let response: Response;
  try {
    response = await fetch(COMPARE_API_URL, {
      headers: {
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "loka-pay-web (https://zerobars.us)",
      },
      // The answer is large and grows with every commit; lib/cached-read.ts caches the summary.
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new GitHubError("GitHub did not answer within 10 s");
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (remaining === "0" || response.status === 429) {
      const when = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : "";
      throw new GitHubError(`GitHub's limit for requests without a token is used up${when}`);
    }
  }
  if (!response.ok) throw new GitHubError(`GitHub answered HTTP ${response.status}`);
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new GitHubError("GitHub's answer was not JSON");
  }
  return summarizeCompare(body);
}

export function readBuiltThisWeekend(): Promise<Read<BuiltThisWeekend>> {
  return cachedRead(`github-compare:${REPO}:${KIT_TAG}`, REVALIDATE_SECONDS, readCompareUncached);
}
