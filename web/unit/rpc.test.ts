import { expect, test } from "@playwright/test";
import { DEFAULT_RPC_URL, hostsOf, publicEndpoint } from "../lib/solana";

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
