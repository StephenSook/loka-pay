import { readFileSync, readdirSync, statSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { E2E_GITHUB_TOKEN } from "../e2e/fixtures/ports";
import { readProgramFactsUncached } from "../lib/chain";
import { GitHubError, githubApiBase, githubHeaders, readMainChecksUncached } from "../lib/github";
import { serverReadOptions, serverRpcUrl } from "../lib/server-rpc";
import { E2E_TEST_TOKEN, UpstreamConfigError, isLoopback } from "../lib/test-upstream";

// Server-only configuration (GITHUB_TOKEN, SOLANA_RPC_URL, GITHUB_API_URL) must never reach a
// browser: no client module may import the modules that read it. A real token goes only to
// https://api.github.com, and the local test seam (lib/test-upstream.ts) opens only in the
// e2e test mode and never in a deployed production build. The local server below is a TEST
// FIXTURE on 127.0.0.1.

const WEB = path.join(__dirname, "..");

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

function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  set(vars);
  return run().finally(() => set(before));
}

// Every variable these tests set, cleared first so the machine's own settings never leak in.
const CLEAN = { GITHUB_TOKEN: undefined, GITHUB_API_URL: undefined, LOKA_E2E_UPSTREAM: undefined, SOLANA_RPC_URL: undefined, VERCEL: undefined, NODE_ENV: "test" };
const env = <T>(vars: Record<string, string | undefined>, run: () => Promise<T>) => withEnv({ ...CLEAN, ...vars }, run);
const DEPLOYED = { NODE_ENV: "production", VERCEL: "1" };
const REAL = "ghp_this-stands-for-a-real-token";
const API = "https://api.github.com/repos/StephenSook/loka-pay/commits/main/check-runs";

test.describe("GITHUB_TOKEN goes only to https://api.github.com", () => {
  test("set: a request to https://api.github.com carries it as a Bearer token", async () => {
    await env({ GITHUB_TOKEN: REAL }, async () => {
      expect(githubHeaders(API).authorization).toBe(`Bearer ${REAL}`);
      expect(githubHeaders("https://api.github.com:443/x").authorization).toBe(`Bearer ${REAL}`);
    });
  });

  test("never to another host, another port, or over http", async () => {
    await env({ GITHUB_TOKEN: REAL }, async () => {
      for (const url of [
        "http://api.github.com/x",
        "https://api.github.com:8443/x",
        "https://api.github.com.example.org/x",
        "https://example.org/x",
        "http://127.0.0.1:3190/github/x",
      ]) {
        expect(githubHeaders(url).authorization, url).toBeUndefined();
      }
    });
    // An explicit request to a local server, outside test mode, carries no token either.
    await withGitHubStandIn(200, (url, seen) =>
      env({ GITHUB_TOKEN: REAL }, async () => {
        await readMainChecksUncached(url, 5000);
        expect(seen[0].authorization).toBeUndefined();
      }),
    );
  });

  test("unset or blank: no Authorization header at all", async () => {
    for (const value of [undefined, "", "   "]) {
      await env({ GITHUB_TOKEN: value }, async () => expect(githubHeaders(API).authorization, JSON.stringify(value)).toBeUndefined());
    }
  });

  test("GITHUB_API_URL naming another host is refused, so no request and no token goes there", async () => {
    for (const base of ["https://example.org", "http://github-proxy.example.org/api", "https://api.github.com.example.org"]) {
      await env({ GITHUB_TOKEN: REAL, GITHUB_API_URL: base, LOKA_E2E_UPSTREAM: "1" }, async () => {
        expect(() => githubApiBase(), base).toThrow(UpstreamConfigError);
        const error = await readMainChecksUncached().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(UpstreamConfigError);
        expect((error as Error).message).toContain("GITHUB_API_URL");
        expect((error as Error).message).not.toContain(new URL(base).host);
      });
    }
  });

  test("a local GITHUB_API_URL works only in the e2e test mode", async () => {
    await withGitHubStandIn(200, async (url, seen) => {
      const base = new URL(url).origin;
      await env({ GITHUB_API_URL: base }, async () => {
        const error = await readMainChecksUncached().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(UpstreamConfigError);
        expect((error as Error).message).toBe("GITHUB_API_URL names a local test endpoint, which is accepted only in the e2e test mode (LOKA_E2E_UPSTREAM=1)");
      });
      expect(seen).toHaveLength(0);
      await env({ GITHUB_API_URL: base, LOKA_E2E_UPSTREAM: "1" }, async () => {
        expect(githubApiBase()).toBe(base);
      });
    });
  });

  test("a deployed production build refuses any override, even in test mode, naming the variable", async () => {
    await env({ ...DEPLOYED, LOKA_E2E_UPSTREAM: "1", GITHUB_API_URL: "http://127.0.0.1:3190/github" }, async () => {
      expect(() => githubApiBase()).toThrow("GITHUB_API_URL names a local test endpoint, which a deployed production build refuses");
    });
    // Unset, the real API is used there, and a real token goes to it.
    await env({ ...DEPLOYED, GITHUB_TOKEN: REAL }, async () => {
      expect(githubApiBase()).toBe("https://api.github.com");
      expect(githubHeaders(API).authorization).toBe(`Bearer ${REAL}`);
    });
  });

  test("in test mode only the e2e test token is sent, and only to the local stand-in", async () => {
    await withGitHubStandIn(200, async (url, seen) => {
      await env({ LOKA_E2E_UPSTREAM: "1", GITHUB_API_URL: new URL(url).origin, GITHUB_TOKEN: E2E_TEST_TOKEN }, async () => {
        await readMainChecksUncached(url, 5000);
        expect(seen[0].authorization).toBe(`Bearer ${E2E_TEST_TOKEN}`);
        expect(githubHeaders(API).authorization).toBeUndefined();
      });
      // A real token is never sent while the test seam is open, not even to GitHub.
      await env({ LOKA_E2E_UPSTREAM: "1", GITHUB_API_URL: new URL(url).origin, GITHUB_TOKEN: REAL }, async () => {
        await readMainChecksUncached(url, 5000);
        expect(seen[1].authorization).toBeUndefined();
        expect(githubHeaders(API).authorization).toBeUndefined();
      });
    });
  });

  test("the e2e stand-in's token is the one test mode accepts", () => {
    expect(E2E_GITHUB_TOKEN).toBe(E2E_TEST_TOKEN);
  });

  test("a spent limit with the token says so without ever printing the token", async () => {
    await withGitHubStandIn(403, (url) =>
      env({ LOKA_E2E_UPSTREAM: "1", GITHUB_API_URL: new URL(url).origin, GITHUB_TOKEN: E2E_TEST_TOKEN }, async () => {
        const error = await readMainChecksUncached(url, 5000).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GitHubError);
        expect((error as GitHubError).message).toBe("GitHub's limit for this site's token is used up");
        expect((error as GitHubError).message).not.toContain(E2E_TEST_TOKEN);
      }),
    );
  });
});

test.describe("SOLANA_RPC_URL: any real provider, a local endpoint only in test mode", () => {
  const KEYED = "https://devnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE";

  test("a keyed provider URL is accepted, also in a deployed production build", async () => {
    await env({ ...DEPLOYED, SOLANA_RPC_URL: KEYED }, async () => {
      expect(serverRpcUrl()).toBe(KEYED);
      expect(serverReadOptions().url).toBe(KEYED);
    });
  });

  test("a local endpoint is refused outside test mode, and in a deployed production build even in test mode", async () => {
    await env({ SOLANA_RPC_URL: "http://127.0.0.1:3190/rpc" }, async () => {
      expect(() => serverReadOptions()).toThrow("SOLANA_RPC_URL names a local test endpoint, which is accepted only in the e2e test mode (LOKA_E2E_UPSTREAM=1)");
    });
    await env({ ...DEPLOYED, LOKA_E2E_UPSTREAM: "1", SOLANA_RPC_URL: "http://localhost:8899" }, async () => {
      expect(() => serverRpcUrl()).toThrow("SOLANA_RPC_URL names a local test endpoint, which a deployed production build refuses");
    });
    await env({ LOKA_E2E_UPSTREAM: "1", SOLANA_RPC_URL: "http://127.0.0.1:3190/rpc" }, async () => {
      expect(serverRpcUrl()).toBe("http://127.0.0.1:3190/rpc");
    });
  });

  test("a refused endpoint fails the read with its named reason, sending nothing", async () => {
    await env({ SOLANA_RPC_URL: "http://127.0.0.1:3190/rpc" }, async () => {
      await expect(readProgramFactsUncached()).rejects.toThrow(UpstreamConfigError);
    });
  });
});

// Every way a URL can name this machine, after the URL parser normalizes it, is a local test
// endpoint: refused without the test mode, and always in a deployed production build.
test.describe("loopback endpoints in every form", () => {
  const LOCAL = [
    "http://127.0.0.1:3190/rpc",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://0177.0.0.1",
    "http://127.0.0.2:8899",
    "http://127.255.255.254",
    "http://127.0.0.1.",
    "https://127.0.0.1",
    "http://[::1]:8899",
    "http://[0:0:0:0:0:0:0:1]",
    "http://[::ffff:127.0.0.1]",
    "http://[::ffff:7f00:1]",
    "http://[::ffff:7f00:2]",
    "http://[::ffff:0:0]",
    "http://[::7f00:1]",
    "http://[::127.0.0.1]",
    "http://[::]",
    "http://0.0.0.0:8899",
    "http://0",
    "http://localhost:8899",
    "http://LOCALHOST.",
    "http://localhost%2e",
    "http://api.localhost",
    "http://rpc.devnet.localhost.",
  ];
  const REMOTE = [
    "https://api.devnet.solana.com",
    "https://devnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE",
    "https://solana-devnet.g.alchemy.com/v2/SECRET-KEY-VALUE",
    "https://example.com:8899",
    "http://128.0.0.1",
    "http://10.0.0.1",
    "http://[::2]",
    "http://[::a00:1]",
    "http://[::ffff:8.8.8.8]",
    "http://[::1:0:0:1]",
    "http://[2001:db8::1]",
    "http://localhost.example.com",
    "http://notlocalhost",
  ];

  test("each local form is recognized; remote hosts are not", () => {
    for (const url of LOCAL) expect(isLoopback(url), url).toBe(true);
    for (const url of REMOTE) expect(isLoopback(url), url).toBe(false);
    expect(isLoopback("not a url")).toBe(false);
  });

  test("SOLANA_RPC_URL naming any local form is refused without the test mode, and in deployed production even with it", async () => {
    for (const url of LOCAL) {
      await env({ SOLANA_RPC_URL: url }, async () => {
        expect(() => serverRpcUrl(), url).toThrow("accepted only in the e2e test mode");
      });
      await env({ ...DEPLOYED, LOKA_E2E_UPSTREAM: "1", SOLANA_RPC_URL: url }, async () => {
        expect(() => serverRpcUrl(), url).toThrow("a deployed production build refuses");
      });
      await env({ LOKA_E2E_UPSTREAM: "1", SOLANA_RPC_URL: url }, async () => {
        expect(serverRpcUrl(), url).toBe(url);
      });
    }
  });

  test("GITHUB_API_URL naming any local form is refused the same way", async () => {
    for (const url of LOCAL) {
      await env({ GITHUB_API_URL: url }, async () => expect(() => githubApiBase(), url).toThrow("accepted only in the e2e test mode"));
      await env({ ...DEPLOYED, LOKA_E2E_UPSTREAM: "1", GITHUB_API_URL: url }, async () =>
        expect(() => githubApiBase(), url).toThrow("a deployed production build refuses"),
      );
    }
  });

  test("real HTTPS providers, keyed in the query or the path, are accepted in deployed production", async () => {
    for (const url of REMOTE.filter((u) => u.startsWith("https://"))) {
      await env({ ...DEPLOYED, SOLANA_RPC_URL: url }, async () => {
        expect(serverRpcUrl(), url).toBe(url);
        expect(serverReadOptions().url, url).toBe(url);
      });
    }
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
  // /call's panel reaches the shared checks, so the walk sees the call files too.
  expect(rel).toContain("lib/call-shared.ts");
  for (const serverOnly of [
    "lib/github.ts",
    "lib/server-rpc.ts",
    "lib/test-upstream.ts",
    "lib/cached-read.ts",
    "lib/chain.ts",
    "lib/claims.ts",
    "lib/call-server.ts",
    "lib/call-crypto.ts",
    "lib/call-limits.ts",
    "lib/call-payment.ts",
  ]) {
    expect(rel, `${serverOnly} is reachable from a client module`).not.toContain(serverOnly);
  }
});

test("every variable /call reads (its keys and secret among them) is read in lib/call-server.ts only, never under a NEXT_PUBLIC name", () => {
  // The names come from the file itself, so a new variable is covered without listing it here.
  const names = [...readFileSync(path.join(WEB, "lib", "call-server.ts"), "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  const distinct = [...new Set(names)];
  // Floor: the five required variables, the off switch, the voice, the origin and two test seams.
  expect(distinct.length).toBeGreaterThanOrEqual(10);
  // The platform's own variables (VERCEL, VERCEL_ENV) are read elsewhere too.
  for (const name of distinct.filter((n) => !PLATFORM_VARIABLES.has(n))) {
    expect(name, name).not.toMatch(/^NEXT_PUBLIC_/);
    const readers = ALL.filter((f) => readFileSync(f, "utf8").includes(`process.env.${name}`)).map((f) => path.relative(WEB, f));
    expect(readers, name).toEqual(["lib/call-server.ts"]);
  }
  for (const f of ALL) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_(VONAGE|ELEVENLABS|LOKA_CALL)/);
});

test("GITHUB_TOKEN is read in lib/github.ts only, and never under a NEXT_PUBLIC name", () => {
  const readers = ALL.filter((f) => readFileSync(f, "utf8").includes("GITHUB_TOKEN")).map((f) => path.relative(WEB, f));
  expect(readers).toEqual(["lib/github.ts"]);
  for (const f of ALL) expect(readFileSync(f, "utf8"), f).not.toMatch(/NEXT_PUBLIC_GITHUB/);
});

// Set by the platform, not by us: never listed in .env.example.
const PLATFORM_VARIABLES = new Set(["NODE_ENV", "VERCEL", "VERCEL_ENV"]);

test(".env.example lists exactly the variables the code reads", () => {
  const read = new Set(
    ALL.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1])).filter((v) => !PLATFORM_VARIABLES.has(v)),
  );
  const listed = new Set([...readFileSync(path.join(WEB, ".env.example"), "utf8").matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]));
  expect(read.size).toBeGreaterThanOrEqual(4);
  expect([...listed].sort()).toEqual([...read].sort());
});
