// GitHub reads, from the public API with no token, cached for 5 minutes (lib/cached-read.ts):
// - "Built this weekend" (PLAN.md 3.60): what changed in the repository since the pre-event
//   kit tag (the compare API). A rate-limited or failed read is never replaced by an old or
//   typed-in number: the page shows the compare link and says the count is unavailable;
// - main's checks: the result of each GitHub Actions job on main's latest commit (the check
//   runs API), behind the program CI claim on /proof.

import { cachedRead, sourceTag, type CachedReadOptions, type Read, type ReadPolicy } from "./cached-read";
import { KIT_TAG } from "./facts";
import { REPO_URL } from "./site";

export const REPO = "StephenSook/loka-pay";
export const DEFAULT_GITHUB_API = "https://api.github.com";

/**
 * The GitHub API base: GITHUB_API_URL (server only), or api.github.com. Only the e2e tests
 * change it, to a local stand-in (playwright.config.ts). Read when each request is made.
 */
export function githubApiBase(): string {
  return (process.env.GITHUB_API_URL?.trim() || DEFAULT_GITHUB_API).replace(/\/+$/, "");
}

export function compareApiUrl(): string {
  return `${githubApiBase()}/repos/${REPO}/compare/${KIT_TAG}...main`;
}

/** The check runs of main's latest commit (one per GitHub Actions job), newest attempt of each. */
export function checksApiUrl(): string {
  return `${githubApiBase()}/repos/${REPO}/commits/main/check-runs?per_page=100&filter=latest`;
}
/** The program workflow's one job (.github/workflows/program.yml): the secp256r1 feature check, then anchor test. */
export const PROGRAM_JOB = "program (secp256r1 feature check, anchor test)";
/**
 * Every workflow in .github/workflows/ with its one job's name, as GitHub's check runs name
 * it (unit/evidence.test.ts compares them with the workflow files). /judge shows each
 * job's result on main's latest commit.
 */
export const WORKFLOWS = [
  { file: "ios", job: "ios (package tests, app build, release checks)" },
  { file: "android", job: "android (core tests, debug build, lint)" },
  { file: "program", job: PROGRAM_JOB },
  { file: "server", job: "server (typecheck, unit, integration, vectors)" },
  { file: "web", job: "web (lint, typecheck, build, Playwright)" },
  { file: "hygiene", job: "hygiene (gitleaks, scrub guard, prose gate, FACTS)" },
] as const;
export const COMPARE_PAGE_URL = `${REPO_URL}/compare/${KIT_TAG}...main`;
/**
 * GitHub reads: cached 5 minutes; current for 60 s; at most 3 reads of each kind per minute
 * in one server process, and a minute without that read after GitHub says the limit for
 * requests without a token (60 an hour) is used up.
 */
export const GITHUB_READS: ReadPolicy = {
  revalidateSeconds: 300,
  currentForMs: 60_000,
  reuseForMs: 45_000,
  limits: { reads: 3, perMs: 60_000, rateLimitPauseMs: 60_000 },
};

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
  /** True when GitHub refused for its rate limit: the read is paused, never retried (lib/read-state.ts). */
  readonly rateLimited: boolean;
  constructor(message: string, rateLimited = false) {
    super(message);
    this.name = "GitHubError";
    this.rateLimited = rateLimited;
  }
}

interface CompareCommit {
  author: { login?: unknown } | null;
  commit: { author: { date?: unknown } | null };
}

/** A count GitHub reports: a non-negative safe integer, never a fraction, a negative or a missing value. */
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * Reduces a compare answer to the panel's numbers. Throws GitHubError on an unexpected shape,
 * including any file record without a count of added lines: a missing measurement is never
 * counted as zero.
 */
export function summarizeCompare(body: unknown): BuiltThisWeekend {
  const b = body as { total_commits?: unknown; commits?: unknown; files?: unknown } | null;
  if (!b || !isCount(b.total_commits) || !Array.isArray(b.commits) || !Array.isArray(b.files)) {
    throw new GitHubError("GitHub's compare answer had an unexpected shape");
  }
  if (!b.commits.every((c) => typeof c === "object" && c !== null)) {
    throw new GitHubError("GitHub's compare answer listed a commit of an unexpected shape");
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
  const files = b.files as Array<{ additions?: unknown } | null>;
  let additions = 0;
  for (const f of files) {
    if (typeof f !== "object" || f === null || !isCount(f.additions)) {
      throw new GitHubError("GitHub's compare answer listed a file without a count of added lines");
    }
    additions += f.additions;
  }
  if (!Number.isSafeInteger(additions)) throw new GitHubError("GitHub's compare answer added up to more lines than this page can count");
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

/**
 * GITHUB_TOKEN: optional, server only (no NEXT_PUBLIC prefix, so Next never inlines it into a
 * browser bundle; this module is imported by server code only, which unit/server-only.test.ts
 * checks). With it, GitHub's limit is the token's (5,000 an hour) instead of 60 an hour per
 * IP, which shared hosting addresses can use up. Read when each request is made; never
 * logged, never put in an error message, never rendered.
 */
function githubToken(): string | null {
  const token = process.env.GITHUB_TOKEN?.trim();
  return token ? token : null;
}

/**
 * The headers of a GitHub API request to `url`: the token's Authorization only when
 * GITHUB_TOKEN is set AND the request goes to the configured API base, so the token is never
 * sent to any other host.
 */
export function githubHeaders(url: string): Record<string, string> {
  const token = new URL(url).origin === new URL(githubApiBase()).origin ? githubToken() : null;
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": "loka-pay-web (https://zerobars.us)",
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** A GitHub API answer as JSON, or a GitHubError that says what failed (a timeout, the rate limit, an HTTP status). */
async function getGitHubJson(url: string, timeoutMs: number): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: githubHeaders(url),
      // lib/cached-read.ts caches the decoded summary with its read time, never the raw answer.
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Only a timeout is a timeout; a refused connection or a DNS failure says so.
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new GitHubError(`GitHub did not answer within ${timeoutMs / 1000} s`);
    }
    throw new GitHubError(`could not reach ${new URL(url).host}`);
  }
  if (response.status === 403 || response.status === 429) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    if (remaining === "0" || response.status === 429) {
      const when = Number.isFinite(reset) && reset > 0 ? ` until ${new Date(reset * 1000).toISOString()}` : "";
      const whose = githubToken() ? "GitHub's limit for this site's token" : "GitHub's limit for requests without a token";
      throw new GitHubError(`${whose} is used up${when}`, true);
    }
  }
  if (!response.ok) throw new GitHubError(`GitHub answered HTTP ${response.status}`);
  try {
    return await response.json();
  } catch (e) {
    // The compare answer is over 1 MB: a limit that passes mid-body is a timeout, not bad JSON.
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new GitHubError(`GitHub did not finish answering within ${timeoutMs / 1000} s`);
    }
    throw new GitHubError("GitHub's answer was not JSON");
  }
}

/** The compare read. The URL and limit are parameters only so tests can point it at a local server. */
export async function readCompareUncached(url: string = compareApiUrl(), timeoutMs = 10_000): Promise<BuiltThisWeekend> {
  return summarizeCompare(await getGitHubJson(url, timeoutMs));
}

/** One GitHub Actions job on main's latest commit, as GitHub's check runs API reports it. */
export interface CheckRun {
  /** The job's name, for example PROGRAM_JOB. */
  name: string;
  /** "queued", "in_progress", "completed", or another state GitHub names. */
  status: string;
  /** Set once completed: "success", "failure", "cancelled", "timed_out", "skipped", ... */
  conclusion: string | null;
  /** The job's page on github.com. */
  htmlUrl: string;
}

export interface MainChecks {
  /** The commit main pointed at when GitHub answered; null when it listed no GitHub Actions job. */
  sha: string | null;
  /** GitHub Actions jobs only; another app's check with the same name is not one of ours. */
  runs: CheckRun[];
}

const SHA = /^[0-9a-f]{40}$/;
const JOB_URL_PREFIX = `https://github.com/${REPO}/`;

/** Reduces a check runs answer to main's GitHub Actions jobs. Throws GitHubError on an unexpected shape. */
export function summarizeCheckRuns(body: unknown): MainChecks {
  const b = body as { check_runs?: unknown } | null;
  if (!b || typeof b !== "object" || !Array.isArray(b.check_runs)) {
    throw new GitHubError("GitHub's check runs answer had an unexpected shape");
  }
  const runs: CheckRun[] = [];
  const shas = new Set<string>();
  for (const item of b.check_runs as unknown[]) {
    const c = item as { name?: unknown; head_sha?: unknown; status?: unknown; conclusion?: unknown; html_url?: unknown; app?: { slug?: unknown } | null } | null;
    if (
      !c ||
      typeof c.name !== "string" ||
      typeof c.head_sha !== "string" ||
      !SHA.test(c.head_sha) ||
      typeof c.status !== "string" ||
      !(c.conclusion === null || typeof c.conclusion === "string") ||
      typeof c.html_url !== "string"
    ) {
      throw new GitHubError("GitHub's check runs answer listed a check of an unexpected shape");
    }
    if (c.app?.slug !== "github-actions") continue;
    if (!c.html_url.startsWith(JOB_URL_PREFIX)) throw new GitHubError("a check run's page is not in this repository");
    shas.add(c.head_sha);
    runs.push({ name: c.name, status: c.status, conclusion: c.conclusion, htmlUrl: c.html_url });
  }
  if (shas.size > 1) throw new GitHubError("GitHub listed check runs for more than one commit");
  return { sha: shas.size === 1 ? [...shas][0] : null, runs };
}

/** The check runs read. The URL and limit are parameters only so tests can point it at a local server. */
export async function readMainChecksUncached(url: string = checksApiUrl(), timeoutMs = 10_000): Promise<MainChecks> {
  return summarizeCheckRuns(await getGitHubJson(url, timeoutMs));
}

/** `needCurrent` for a page whose claims say Live (lib/cached-read.ts). */
export function readMainChecks(options: CachedReadOptions = {}): Promise<Read<MainChecks>> {
  return cachedRead(`github-checks:${sourceTag(githubApiBase())}:${REPO}:main`, GITHUB_READS, () => readMainChecksUncached(), options);
}

export function readBuiltThisWeekend(): Promise<Read<BuiltThisWeekend>> {
  return cachedRead(`github-compare:${sourceTag(githubApiBase())}:${REPO}:${KIT_TAG}`, GITHUB_READS, () => readCompareUncached());
}
