import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { GitHubError, githubHeaders, readMainChecksUncached } from "../lib/github";

// Server-only configuration (GITHUB_TOKEN, SOLANA_RPC_URL) must never reach a browser: no
// client module may import the modules that read it, and the token goes only on server
// requests to GitHub. The local server below is a TEST FIXTURE on 127.0.0.1.

const WEB = path.join(__dirname, "..");
const SENTINEL = "test-token-not-a-secret";

async function withGitHubStandIn(status: number, run: (url: string, seen: IncomingHttpHeaders[]) => Promise<void>) {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    if (status === 403) {
      res.writeHead(403, { "content-type": "application/json", "x-ratelimit-remaining": "0" });
      res.end(JSON.stringify({ message: "API rate limit exceeded" }));
      return;
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ total_count: 0, check_runs: [] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}/check-runs`, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

function withToken<T>(value: string | undefined, run: () => Promise<T>): Promise<T> {
  const before = process.env.GITHUB_TOKEN;
  if (value === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = value;
  return run().finally(() => {
    if (before === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = before;
  });
}

test.describe("GITHUB_TOKEN", () => {
  test("set: GitHub requests carry it as a Bearer token", async () => {
    await withToken(SENTINEL, () =>
      withGitHubStandIn(200, async (url, seen) => {
        await readMainChecksUncached(url, 5000);
        expect(seen).toHaveLength(1);
        expect(seen[0].authorization).toBe(`Bearer ${SENTINEL}`);
      }),
    );
  });

  test("unset or blank: no Authorization header at all", async () => {
    for (const value of [undefined, "", "   "]) {
      await withToken(value, () =>
        withGitHubStandIn(200, async (url, seen) => {
          await readMainChecksUncached(url, 5000);
          expect(seen[0].authorization, JSON.stringify(value)).toBeUndefined();
        }),
      );
      await withToken(value, async () => expect(githubHeaders().authorization).toBeUndefined());
    }
  });

  test("a spent limit with the token says so without ever printing the token", async () => {
    await withToken(SENTINEL, () =>
      withGitHubStandIn(403, async (url) => {
        const error = await readMainChecksUncached(url, 5000).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).toBe("GitHub's limit for this site's token is used up");
        expect((error as GitHubError).message).not.toContain(SENTINEL);
      }),
    );
  });
});

/** Every .ts and .tsx file under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const ALL = ["app", "components", "lib"].flatMap((d) => sources(path.join(WEB, d)));

/** The project files a module imports at run time (type-only imports are erased and skipped). */
function runtimeImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:import|export)\s+(type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']/gm)) {
    if (m[1]) continue;
    const spec = m[2];
    const base = spec.startsWith("@/") ? path.join(WEB, spec.slice(2)) : spec.startsWith(".") ? path.resolve(path.dirname(file), spec) : null;
    if (!base) continue;
    const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((c) => ALL.includes(c));
    if (found) out.push(found);
  }
  return out;
}

test("no client module reaches a module that reads server-only configuration", () => {
  const clients = ALL.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
  expect(clients.length).toBeGreaterThanOrEqual(3);
  const reached = new Set<string>();
  const queue = [...clients];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (reached.has(file)) continue;
    reached.add(file);
    queue.push(...runtimeImports(file));
  }
  const rel = [...reached].map((f) => path.relative(WEB, f)).sort();
  // The walk follows imports: live-feed reaches lib/program-feed.ts, so it is not vacuous.
  expect(rel).toContain("lib/program-feed.ts");
  for (const serverOnly of ["lib/github.ts", "lib/server-rpc.ts", "lib/cached-read.ts", "lib/chain.ts", "lib/claims.ts"]) {
    expect(rel, `${serverOnly} is reachable from a client module`).not.toContain(serverOnly);
  }
});

test("GITHUB_TOKEN is read in lib/github.ts only, and never under a NEXT_PUBLIC name", () => {
  const readers = ALL.filter((f) => readFileSync(f, "utf8").includes("GITHUB_TOKEN")).map((f) => path.relative(WEB, f));
  expect(readers).toEqual(["lib/github.ts"]);
  for (const f of ALL) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_GITHUB/);
});

test(".env.example lists exactly the variables the code reads", () => {
  const read = new Set(ALL.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])));
  const listed = new Set([...readFileSync(path.join(WEB, ".env.example"), "utf8").matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  expect(read.size).toBeGreaterThanOrEqual(4);
  expect([...listed].sort()).toEqual([...read].sort());
});
