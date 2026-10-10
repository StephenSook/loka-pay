import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { PINS } from "../lib/pins";
import { isRateLimited } from "../lib/read-state";
import { SETTLEMENT_HEALTH_URL, SettlementError, readServerHealthUncached, remittanceRoute, settlementApiBase, summarizeHealth } from "../lib/settlement";
import { UpstreamConfigError } from "../lib/test-upstream";

// The /v1/remittances entry of phase3Routes, as server/src/app/phase3.ts on feat/phase3-measure
// reports it: { registered, reason } with reason null when registered.
test.describe("remittanceRoute: the health answer's phase3Routes entry for POST /v1/remittances", () => {
  const routes = (entry: unknown) => ({ phase3Routes: { "/api/volume": { registered: true, reason: null }, "/v1/remittances": entry } });

  test("registered: on", () => {
    expect(remittanceRoute(routes({ registered: true, reason: null }))).toEqual({ registered: true });
  });

  test("not registered: off, with the server's reason", () => {
    for (const reason of ["missing_config", "invalid_config", "initialization_failed"]) {
      expect(remittanceRoute(routes({ registered: false, reason }))).toEqual({ registered: false, reason });
    }
    expect(remittanceRoute(routes({ registered: false, reason: null }))).toEqual({ registered: false, reason: "no reason given" });
  });

  test("no readable entry (today's server on main has no phase3Routes): null, which /send treats as off", () => {
    for (const body of [
      { ok: true, slot: 1 },
      null,
      "x",
      { phase3Routes: null },
      { phase3Routes: [] },
      { phase3Routes: { "/api/volume": { registered: true, reason: null } } },
      routes(null),
      routes({ registered: "true" }),
      routes({}),
    ]) {
      expect(remittanceRoute(body), JSON.stringify(body)).toBeNull();
    }
  });

  test("summarizeHealth carries it on both 200 and 503 answers", () => {
    expect(summarizeHealth(200, { ...OK, ...routes({ registered: true, reason: null }) }, HOST).remittances).toEqual({ registered: true });
    expect(summarizeHealth(503, { ...DOWN, ...routes({ registered: false, reason: "missing_config" }) }, HOST).remittances).toEqual({
      registered: false,
      reason: "missing_config",
    });
  });
});

// The settlement API's health read (lib/settlement.ts). The local servers below are TEST
// FIXTURES on 127.0.0.1 answering in the shapes server/src/app/app.ts sends (API-V1 section 6).

const HOST = "api.zerobars.us";
// The server sends its git sha here; any string passes through, so a short one stands in.
const SHA = "c853330";
const OK = { ok: true, commit: SHA, cluster: "devnet", programId: PINS.programId, slot: 600_000_123 };
const DOWN = { ok: false, commit: SHA, cluster: "devnet", programId: PINS.programId, slot: null };

test("the evidence link is always the real health check", () => {
  expect(SETTLEMENT_HEALTH_URL).toBe("https://api.zerobars.us/api/health");
});

test.describe("summarizeHealth", () => {
  test("200 with ok true and a slot: the answer as the server gave it", () => {
    expect(summarizeHealth(200, OK, HOST)).toEqual({ ok: true, commit: SHA, cluster: "devnet", programId: PINS.programId, slot: 600_000_123, remittances: null });
  });

  test("503 with ok false: a read that says the server cannot reach devnet, with no slot", () => {
    expect(summarizeHealth(503, DOWN, HOST)).toEqual({ ok: false, commit: SHA, cluster: "devnet", programId: PINS.programId, slot: null, remittances: null });
  });

  test("any other status fails the read, naming the host and status; 429 is a rate limit", () => {
    for (const status of [404, 500, 502]) expect(() => summarizeHealth(status, OK, HOST), String(status)).toThrow(`${HOST} answered HTTP ${status}`);
    const limited = (() => {
      try {
        summarizeHealth(429, { error: "rate_limited" }, HOST);
      } catch (e) {
        return e;
      }
    })();
    expect(limited).toBeInstanceOf(SettlementError);
    expect(isRateLimited(limited)).toBe(true);
    expect(isRateLimited(new SettlementError("x"))).toBe(false);
  });

  test("a body of the wrong shape fails the read: never a value from it", () => {
    const bad: unknown[] = [
      null,
      "ok",
      { ...OK, ok: "true" },
      { ...OK, slot: 0 },
      { ...OK, slot: 1.5 },
      { ...OK, slot: "600000123" },
      { ...OK, slot: null },
      { ...OK, programId: 7 },
      { ok: true, slot: 1 },
      { ...OK, commit: undefined },
    ];
    for (const body of bad) expect(() => summarizeHealth(200, body, HOST), JSON.stringify(body)).toThrow(`${HOST}'s health answer had an unexpected shape`);
    // A 503 that is not the health answer (a proxy's error page) says the status, not a health state.
    for (const body of [null, { ...DOWN, ok: true }, { error: "x" }]) {
      expect(() => summarizeHealth(503, body, HOST), JSON.stringify(body)).toThrow(`${HOST} answered HTTP 503 without its health answer`);
    }
  });
});

async function withServer(answer: (path: string) => { status: number; body: string } | "hang", run: (base: string, paths: string[]) => Promise<void>) {
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    req.resume();
    const a = answer(req.url ?? "");
    if (a === "hang") return;
    res.writeHead(a.status, { "content-type": "application/json" });
    res.end(a.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, paths);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test.describe("readServerHealthUncached against a local stand-in", () => {
  test("reads /api/health and returns the answer", async () => {
    await withServer(
      () => ({ status: 200, body: JSON.stringify(OK) }),
      async (base, paths) => {
        expect(await readServerHealthUncached(`${base}/api/health`, 5000)).toEqual({ ...OK, remittances: null });
        expect(paths).toEqual(["/api/health"]);
      },
    );
  });

  test("503 with the health answer is a successful read of a server that cannot reach devnet", async () => {
    await withServer(
      () => ({ status: 503, body: JSON.stringify(DOWN) }),
      async (base) => expect((await readServerHealthUncached(`${base}/api/health`, 5000)).ok).toBe(false),
    );
  });

  test("a non-JSON answer, a refused connection and a hang each fail with their own reason", async () => {
    await withServer(
      () => ({ status: 502, body: "<html>Bad gateway</html>" }),
      async (base) => {
        await expect(readServerHealthUncached(`${base}/api/health`, 5000)).rejects.toThrow(`${new URL(base).host} answered HTTP 502`);
      },
    );
    await withServer(
      () => ({ status: 200, body: "not json" }),
      async (base) => {
        await expect(readServerHealthUncached(`${base}/api/health`, 5000)).rejects.toThrow("health answer had an unexpected shape");
      },
    );
    let closed = "";
    await withServer(
      () => ({ status: 200, body: "{}" }),
      async (base) => {
        closed = base;
      },
    );
    await expect(readServerHealthUncached(`${closed}/api/health`, 5000)).rejects.toThrow(`could not reach ${new URL(closed).host}`);
    await withServer(
      () => "hang",
      async (base) => {
        await expect(readServerHealthUncached(`${base}/api/health`, 300)).rejects.toThrow(`${new URL(base).host} did not answer within 0.3 s`);
      },
    );
  });
});

function withEnv<T>(vars: Record<string, string | undefined>, run: () => Promise<T> | T): Promise<T> {
  const keys = ["SETTLEMENT_API_URL", "LOKA_E2E_UPSTREAM", "VERCEL", "NODE_ENV"];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  set({ SETTLEMENT_API_URL: undefined, LOKA_E2E_UPSTREAM: undefined, VERCEL: undefined, NODE_ENV: "test", ...vars });
  return Promise.resolve()
    .then(run)
    .finally(() => set(before));
}

test.describe("SETTLEMENT_API_URL: the real server always, a local stand-in only in the e2e test mode", () => {
  test("unset or blank: https://api.zerobars.us", async () => {
    for (const value of [undefined, "", "  "]) {
      await withEnv({ SETTLEMENT_API_URL: value }, () => expect(settlementApiBase(), JSON.stringify(value)).toBe("https://api.zerobars.us"));
    }
  });

  test("another host is refused, so no other answer ever counts as the server's", async () => {
    for (const url of ["https://example.org", "https://api.zerobars.us.example.org", "http://api.zerobars.us"]) {
      await withEnv({ SETTLEMENT_API_URL: url, LOKA_E2E_UPSTREAM: "1" }, async () => {
        expect(() => settlementApiBase(), url).toThrow(UpstreamConfigError);
        const error = await readServerHealthUncached().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(UpstreamConfigError);
        expect((error as Error).message).toContain("SETTLEMENT_API_URL");
      });
    }
  });

  test("a local endpoint only in test mode, and never in a deployed production build", async () => {
    await withEnv({ SETTLEMENT_API_URL: "http://127.0.0.1:3190/settlement/" }, () =>
      expect(() => settlementApiBase()).toThrow("SETTLEMENT_API_URL names a local test endpoint, which is accepted only in the e2e test mode (LOKA_E2E_UPSTREAM=1)"),
    );
    await withEnv({ SETTLEMENT_API_URL: "http://127.0.0.1:3190/settlement/", LOKA_E2E_UPSTREAM: "1", NODE_ENV: "production", VERCEL: "1" }, () =>
      expect(() => settlementApiBase()).toThrow("SETTLEMENT_API_URL names a local test endpoint, which a deployed production build refuses"),
    );
    await withEnv({ SETTLEMENT_API_URL: "http://127.0.0.1:3190/settlement/", LOKA_E2E_UPSTREAM: "1" }, () =>
      expect(settlementApiBase()).toBe("http://127.0.0.1:3190/settlement"),
    );
  });
});
