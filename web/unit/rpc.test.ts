import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { readProgramFactsUncached, readReservesUncached } from "../lib/chain";
import { GitHubError, readCompareUncached } from "../lib/github";
import { isRateLimited } from "../lib/read-state";
import { SERVER_READ_DEADLINE_MS, SERVER_RPC_URL, serverReadOptions } from "../lib/server-rpc";
import {
  DEFAULT_RPC_URL,
  PUBLIC_RPC_URLS,
  PUBLIC_WS_URLS,
  PublicEndpointError,
  RpcError,
  deadlineIn,
  hostsOf,
  publicEndpoint,
  rpc,
} from "../lib/solana";

// The RPC endpoints (lib/solana.ts, lib/server-rpc.ts). A NEXT_PUBLIC value is inlined into
// every visitor's browser, so a keyed URL there would publish the key and make /privacy
// untrue. A provider can put its key anywhere in the URL, so the browser endpoints are an
// allowlist of public endpoints that need no key, and anything else must fail the build.

const RPC_VAR = "NEXT_PUBLIC_SOLANA_RPC_URL";
const WS_VAR = "NEXT_PUBLIC_SOLANA_WS_URL";

/** The error publicEndpoint throws for a value, or null when it accepts it. */
function refusal(name: string, value: string, allowed: readonly string[]): Error | null {
  try {
    publicEndpoint(name, value, "fallback", allowed);
    return null;
  } catch (e) {
    return e as Error;
  }
}

test.describe("public endpoints (NEXT_PUBLIC_SOLANA_RPC_URL, NEXT_PUBLIC_SOLANA_WS_URL)", () => {
  test("the allowlists are Solana's public devnet RPC and its WebSocket", () => {
    expect(PUBLIC_RPC_URLS).toEqual(["https://api.devnet.solana.com"]);
    expect(PUBLIC_WS_URLS).toEqual(["wss://api.devnet.solana.com"]);
  });

  test("unset or empty uses the fallback", () => {
    expect(publicEndpoint(RPC_VAR, undefined, DEFAULT_RPC_URL, PUBLIC_RPC_URLS)).toBe(DEFAULT_RPC_URL);
    expect(publicEndpoint(RPC_VAR, "", DEFAULT_RPC_URL, PUBLIC_RPC_URLS)).toBe(DEFAULT_RPC_URL);
  });

  test("an allowlisted endpoint is accepted, also with a trailing slash or an upper case host", () => {
    expect(publicEndpoint(RPC_VAR, "https://api.devnet.solana.com", "x", PUBLIC_RPC_URLS)).toBe("https://api.devnet.solana.com");
    expect(publicEndpoint(RPC_VAR, "https://API.devnet.solana.com/", "x", PUBLIC_RPC_URLS)).toBe("https://api.devnet.solana.com");
    expect(publicEndpoint(WS_VAR, "wss://api.devnet.solana.com/", "x", PUBLIC_WS_URLS)).toBe("wss://api.devnet.solana.com");
  });

  test("a URL carrying an API key in its PATH is refused, naming the variable but never printing the key", () => {
    for (const keyed of [
      "https://solana-devnet.g.alchemy.com/v2/SECRET-KEY-VALUE",
      "https://api.devnet.solana.com/SECRET-KEY-VALUE",
      "wss://api.devnet.solana.com/SECRET-KEY-VALUE",
    ]) {
      const error = refusal(keyed.startsWith("wss") ? WS_VAR : RPC_VAR, keyed, keyed.startsWith("wss") ? PUBLIC_WS_URLS : PUBLIC_RPC_URLS);
      expect(error, keyed).toBeInstanceOf(PublicEndpointError);
      expect(error!.name).toBe("PublicEndpointError");
      expect(error!.message).toContain(keyed.startsWith("wss") ? WS_VAR : RPC_VAR);
      expect(error!.message).toContain("SOLANA_RPC_URL, which only the server reads");
      expect(error!.message).not.toContain("SECRET-KEY-VALUE");
    }
  });

  test("a URL carrying an API key in its QUERY is refused, naming the variable but never printing the key", () => {
    for (const keyed of ["https://devnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE", "https://api.devnet.solana.com/?api-key=SECRET-KEY-VALUE"]) {
      const error = refusal(RPC_VAR, keyed, PUBLIC_RPC_URLS);
      expect(error, keyed).toBeInstanceOf(PublicEndpointError);
      expect(error!.message).toContain(RPC_VAR);
      expect(error!.message).not.toContain("SECRET-KEY-VALUE");
    }
  });

  test("credentials, another host, the other scheme and a value that is not a URL are refused", () => {
    expect(refusal(RPC_VAR, "https://user:pass@api.devnet.solana.com", PUBLIC_RPC_URLS)).toBeInstanceOf(PublicEndpointError);
    expect(refusal(WS_VAR, "wss://devnet.example.org", PUBLIC_WS_URLS)).toBeInstanceOf(PublicEndpointError);
    expect(refusal(RPC_VAR, "wss://api.devnet.solana.com", PUBLIC_RPC_URLS)).toBeInstanceOf(PublicEndpointError);
    expect(refusal(RPC_VAR, "https://api.devnet.solana.com:8899", PUBLIC_RPC_URLS)).toBeInstanceOf(PublicEndpointError);
    expect(refusal(RPC_VAR, "not a url", PUBLIC_RPC_URLS)?.message).toBe(`${RPC_VAR} is not a URL`);
  });

  test("hostsOf names hosts only, once each, never a path or query", () => {
    expect(hostsOf("https://api.devnet.solana.com", "wss://api.devnet.solana.com")).toEqual(["api.devnet.solana.com"]);
    expect(hostsOf("https://devnet.helius-rpc.com/?api-key=SECRET", "wss://a.example.org/path")).toEqual([
      "devnet.helius-rpc.com",
      "a.example.org",
    ]);
  });
});

// A node that accepts every request and never answers (a TEST FIXTURE on 127.0.0.1).
test.describe("server reads have a total time limit and no retries", () => {
  let server: Server;
  let url = "";
  let requests = 0;

  test.beforeAll(async () => {
    server = createServer((req) => {
      requests += 1;
      req.resume();
      // No answer, ever.
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test.beforeEach(() => {
    requests = 0;
  });

  test("the server options: the server endpoint, no retries, a 10 s deadline that starts now", () => {
    const o = serverReadOptions();
    expect(o.url).toBe(SERVER_RPC_URL);
    expect(o.retries).toBe(0);
    expect(o.deadline?.ms).toBe(SERVER_READ_DEADLINE_MS);
    expect(SERVER_READ_DEADLINE_MS).toBe(10_000);
    expect(o.deadline?.signal.aborted).toBe(false);
  });

  test("a hanging call stops at the deadline, long before its 8 s attempt timeout, with one request", async () => {
    const started = Date.now();
    const error = await rpc("getSlot", [], { url, retries: 0, deadline: deadlineIn(300) }).catch((e: unknown) => e);
    const elapsed = Date.now() - started;
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).kind).toBe("timeout");
    expect((error as RpcError).message).toBe("no answer from " + new URL(url).host + " within this read's 0.3 s limit");
    expect(elapsed).toBeLessThan(2000);
    expect(requests).toBe(1);
  });

  test("a deadline that already passed makes no request", async () => {
    const deadline = deadlineIn(1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(rpc("getSlot", [], { url, deadline })).rejects.toThrow(/within this read's 0.001 s limit/);
    expect(requests).toBe(0);
  });

  test("/judge's program facts read against a hanging node fails within its limit, without retrying", async () => {
    const started = Date.now();
    await expect(readProgramFactsUncached({ ...serverReadOptions(400), url })).rejects.toThrow(/limit/);
    expect(Date.now() - started).toBeLessThan(2500);
    // One JSON-RPC batch and one getProgramAccounts, each sent once.
    expect(requests).toBe(2);
  });

  test("/proof's reserves read against a hanging node fails within its limit too", async () => {
    const started = Date.now();
    await expect(readReservesUncached({ ...serverReadOptions(400), url })).rejects.toThrow(/limit/);
    expect(Date.now() - started).toBeLessThan(2500);
    expect(requests).toBe(1);
  });
});

// A node and a GitHub stand-in that answer every request with their rate limit (TEST
// FIXTURES on 127.0.0.1). A rate-limited answer is never retried: retrying only spends more
// of the same limit (lib/read-state.ts pauses the read instead).
test.describe("a rate-limited answer is not retried", () => {
  let server: Server;
  let url = "";
  let requests = 0;

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      requests += 1;
      req.resume();
      if (req.url?.startsWith("/github")) {
        res.writeHead(403, { "content-type": "application/json", "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1791703600" });
        res.end(JSON.stringify({ message: "API rate limit exceeded" }));
        return;
      }
      res.writeHead(429, { "content-type": "application/json", "retry-after": "10" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 0, error: { code: 429, message: "Too many requests" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  test.afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  test.beforeEach(() => {
    requests = 0;
  });

  test("an RPC call answered with HTTP 429 sends one request even with a retry allowed", async () => {
    const error = await rpc("getSlot", [], { url, retries: 1 }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect((error as RpcError).code).toBe(429);
    expect(isRateLimited(error)).toBe(true);
    expect(requests).toBe(1);
  });

  test("GitHub's used-up limit is a rate-limited GitHubError, from one request", async () => {
    const error = await readCompareUncached(`${url}/github/compare`, 5000).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubError);
    expect((error as GitHubError).message).toBe("GitHub's limit for requests without a token is used up until 2026-10-11T07:26:40.000Z");
    expect(isRateLimited(error)).toBe(true);
    expect(requests).toBe(1);
  });
});
