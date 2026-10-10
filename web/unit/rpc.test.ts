import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { readProgramFactsUncached, readReservesUncached } from "../lib/chain";
import { SERVER_READ_DEADLINE_MS, SERVER_RPC_URL, serverReadOptions } from "../lib/server-rpc";
import { DEFAULT_RPC_URL, RpcError, deadlineIn, hostsOf, publicEndpoint, rpc } from "../lib/solana";

// The RPC endpoints (lib/solana.ts, lib/server-rpc.ts). A NEXT_PUBLIC value is inlined into
// every visitor's browser, so a keyed URL there would publish the key and make /privacy
// untrue; such a value must fail the build.

test.describe("public endpoints (NEXT_PUBLIC_SOLANA_RPC_URL, NEXT_PUBLIC_SOLANA_WS_URL)", () => {
  test("unset or empty uses the fallback", () => {
    expect(publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", undefined, DEFAULT_RPC_URL)).toBe(DEFAULT_RPC_URL);
    expect(publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", "", DEFAULT_RPC_URL)).toBe(DEFAULT_RPC_URL);
  });

  test("a plain endpoint is accepted", () => {
    expect(publicEndpoint("NEXT_PUBLIC_SOLANA_WS_URL", "wss://devnet.example.org", "x")).toBe("wss://devnet.example.org");
  });

  test("a URL carrying an API key in its query is refused, naming the variable but never printing the key", () => {
    const keyed = "https://devnet.helius-rpc.com/?api-key=SECRET-KEY-VALUE";
    let message = "";
    try {
      publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", keyed, DEFAULT_RPC_URL);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("NEXT_PUBLIC_SOLANA_RPC_URL");
    expect(message).toContain("SOLANA_RPC_URL, which only the server reads");
    expect(message).not.toContain("SECRET-KEY-VALUE");
  });

  test("credentials in the URL and a value that is not a URL are refused", () => {
    expect(() => publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", "https://user:pass@rpc.example.org", "x")).toThrow(/must not carry/);
    expect(() => publicEndpoint("NEXT_PUBLIC_SOLANA_RPC_URL", "not a url", "x")).toThrow(/is not a URL/);
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
