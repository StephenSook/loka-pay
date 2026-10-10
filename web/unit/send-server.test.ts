import { expect, test } from "@playwright/test";
import { E2E_SERVER_KEY_HEX } from "../e2e/fixtures/ports";
import { pinnedDeployment } from "../lib/deployment";
import type { Read } from "../lib/read-state";
import { sendApiBase, sendAvailability, sendVerifier } from "../lib/send-server";
import type { ServerHealth } from "../lib/settlement";

// /send's server side (lib/send-server.ts): when the form is on, where it posts, and which key
// it checks certificates against. The e2e key seam opens only in the e2e test mode.

const NOW = 1_791_000_000_000;
const HEALTH: ServerHealth = { ok: true, commit: "abc1234", cluster: "devnet", programId: "x", slot: 600_000_000, remittances: { registered: true } };
const read = (data: ServerHealth, staleBecause: { reason: string; atMs: number } | null = null): Read<ServerHealth> => ({
  ok: true,
  data,
  readAtMs: NOW - 1000,
  staleBecause,
  current: staleBecause === null,
  shownAtMs: NOW,
  currentForMs: 10_000,
});
const API = { ok: true as const, base: "https://api.zerobars.us" };

test.describe("sendAvailability: on only while the server reaches devnet and lists the route as registered", () => {
  test("registered and reaching devnet: on", () => {
    expect(sendAvailability(read(HEALTH), API)).toEqual({ on: true, reason: null });
  });

  test("every other state is off, with a reason", () => {
    const off: Array<[Read<ServerHealth>, string]> = [
      [read({ ...HEALTH, remittances: null }), "does not list POST /v1/remittances"],
      [read({ ...HEALTH, remittances: { registered: false, reason: "missing_config" } }), "not running (missing_config)"],
      [read({ ...HEALTH, ok: false, slot: null }), "cannot reach devnet"],
      [read(HEALTH, { reason: "could not reach api.zerobars.us", atMs: NOW }), "latest read of the server's health check failed: could not reach api.zerobars.us"],
      [{ ok: false, reason: "api.zerobars.us did not answer within 10 s", atMs: NOW }, "could not read the server's health check: api.zerobars.us did not answer within 10 s"],
    ];
    for (const [health, reason] of off) {
      const a = sendAvailability(health, API);
      expect(a.on, reason).toBe(false);
      expect(a.reason, reason).toContain(reason);
    }
    expect(sendAvailability(read(HEALTH), { ok: false, reason: "SETTLEMENT_API_URL may only name a local test endpoint" })).toEqual({
      on: false,
      reason: "SETTLEMENT_API_URL may only name a local test endpoint",
    });
  });
});

function withEnv<T>(vars: Record<string, string | undefined>, run: () => T): T {
  const keys = ["SETTLEMENT_TEST_SERVER_KEY", "SETTLEMENT_API_URL", "LOKA_E2E_UPSTREAM", "VERCEL", "NODE_ENV"];
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const set = (values: Record<string, string | undefined>) => {
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };
  set({ SETTLEMENT_TEST_SERVER_KEY: undefined, SETTLEMENT_API_URL: undefined, LOKA_E2E_UPSTREAM: undefined, VERCEL: undefined, NODE_ENV: "test", ...vars });
  try {
    return run();
  } finally {
    set(before);
  }
}

test.describe("sendVerifier: the pinned server key, or the test key only in the e2e test mode", () => {
  test("unset: the pinned key from config/pins.json", () => {
    expect(pinnedDeployment).not.toBeNull();
    withEnv({}, () => {
      const v = sendVerifier();
      expect(v).toEqual({ ok: true, deployment: pinnedDeployment, keySource: "pinned" });
    });
  });

  test("set outside test mode, or in a deployed production build: refused, never used", () => {
    withEnv({ SETTLEMENT_TEST_SERVER_KEY: E2E_SERVER_KEY_HEX }, () => {
      const v = sendVerifier();
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toContain("accepted only in the e2e test mode");
    });
    withEnv({ SETTLEMENT_TEST_SERVER_KEY: E2E_SERVER_KEY_HEX, LOKA_E2E_UPSTREAM: "1", NODE_ENV: "production", VERCEL: "1" }, () => {
      const v = sendVerifier();
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toContain("a deployed production build refuses");
    });
  });

  test("in test mode: the given key, labelled as the e2e test key; a malformed key is refused", () => {
    withEnv({ SETTLEMENT_TEST_SERVER_KEY: E2E_SERVER_KEY_HEX, LOKA_E2E_UPSTREAM: "1" }, () => {
      const v = sendVerifier();
      expect(v).toEqual({ ok: true, deployment: { ...pinnedDeployment!, serverPublicKeyHex: E2E_SERVER_KEY_HEX }, keySource: "e2e_test" });
    });
    withEnv({ SETTLEMENT_TEST_SERVER_KEY: "abc", LOKA_E2E_UPSTREAM: "1" }, () => {
      expect(sendVerifier()).toEqual({ ok: false, reason: "SETTLEMENT_TEST_SERVER_KEY must be 64 hex characters" });
    });
  });
});

test("sendApiBase: the real server unless the e2e test mode names a local stand-in", () => {
  withEnv({}, () => expect(sendApiBase()).toEqual({ ok: true, base: "https://api.zerobars.us" }));
  withEnv({ SETTLEMENT_API_URL: "http://127.0.0.1:3190/settlement", LOKA_E2E_UPSTREAM: "1" }, () =>
    expect(sendApiBase()).toEqual({ ok: true, base: "http://127.0.0.1:3190/settlement" }),
  );
  withEnv({ SETTLEMENT_API_URL: "https://example.org" }, () => expect(sendApiBase().ok).toBe(false));
});
