import { expect, test } from "@playwright/test";
import type { ProgramFacts, ReservesRead } from "../lib/chain";
import { claimsFrom, type Claim } from "../lib/claims";
import { PINS } from "../lib/pins";
import type { Read } from "../lib/read-state";

// The /proof claims (lib/claims.ts). The reads below are TEST FIXTURES shaped like what
// lib/chain.ts returns; only the fields the claims read matter. A claim says Live only from
// a read made for this page view: a failed, stale or cached read leaves it Not checked.

const NOW = 1_791_700_000_000;

function facts(): ProgramFacts {
  return {
    slots: { min: 600_000_000, max: 600_000_002 },
    program: { exists: true, executable: true, owner: "BPFLoaderUpgradeab1e11111111111111111111111", programData: PINS.accounts.config },
    programData: { ok: true, value: { deploySlot: 509_428_340, deployTimeMs: NOW - 86_400_000, upgradeAuthority: PINS.upgradeAuthority, programBytes: 300_000 } },
    config: { ok: true, value: { exists: true, mint: PINS.mint, cluster: 0, mintMatchesPins: true } },
    vault: {
      ok: true,
      value: { amountUnits: "7000000", decimals: 6, mint: PINS.mint, owner: PINS.accounts.vault, mintMatchesPins: true, ownerIsVault: true },
    },
    counts: { ok: true, value: { byType: { Allowance: 1, Merchant: 1, VaultAuthority: 1, VaultConfig: 1 }, other: 0 } },
    init: { ok: true, value: { found: true, slot: 509_428_827, blockTimeMs: NOW - 80_000_000, failed: false, actions: ["initialize_vault"] } },
  };
}

function reserves(redeemedUnits = "2500000"): ReservesRead {
  return {
    slot: 600_000_001,
    listedAt: { first: 600_000_000, check: 600_000_002 },
    vault: { amountUnits: "7000000", decimals: 6, mint: PINS.mint, owner: PINS.accounts.vault, mintMatchesPins: true, ownerIsVault: true },
    allowances: [{ address: PINS.wallets.canary, id: "1", capUnits: "5000000", redeemedUnits, bondUnits: "1000000", expiry: "1800000000" }],
    merchants: [{ address: PINS.wallets.send, keyHashHex: "33".repeat(32), balanceUnits: redeemedUnits }],
    totals: { assets: "7000000", allowanceRemaining: "2500000", bonds: "1000000", merchantBalances: "2500000", liabilities: "6000000", difference: "1000000" },
    anomalies: [],
  };
}

const fresh = <T>(data: T): Read<T> => ({ ok: true, data, readAtMs: NOW, staleBecause: null, fresh: true, askedAtMs: NOW });
const cached = <T>(data: T, ageMs: number): Read<T> => ({
  ok: true,
  data,
  readAtMs: NOW - ageMs,
  staleBecause: null,
  fresh: false,
  askedAtMs: NOW,
});
const stale = <T>(data: T, ageMs: number, reason: string): Read<T> => ({
  ok: true,
  data,
  readAtMs: NOW - ageMs,
  staleBecause: { reason, atMs: NOW },
  fresh: false,
  askedAtMs: NOW,
});
const failed = <T>(reason: string): Read<T> => ({ ok: false, reason, atMs: NOW });

const byId = (claims: Claim[]) => Object.fromEntries(claims.map((c) => [c.id, c]));
const CHAIN_CLAIMS = ["deployed", "initialized", "reserves", "redeemed"];

test("reads made for this page make the chain claims Live, each with its evidence", () => {
  const c = byId(claimsFrom(fresh(facts()), fresh(reserves())));
  for (const id of CHAIN_CLAIMS) {
    expect(c[id].status, id).toBe("live");
    expect(c[id].evidence, id).toBeDefined();
  }
});

test("a cached read, however recent, never makes a claim Live: Not checked, with the read's age", () => {
  const c = byId(claimsFrom(cached(facts(), 60_000), cached(reserves(), 12_000)));
  for (const id of CHAIN_CLAIMS) expect(c[id].status, id).toBe("unchecked");
  expect(c.deployed.note).toContain("Only a cached devnet read");
  expect(c.deployed.note).toContain("60 s old");
  expect(c.reserves.note).toContain("12 s old");
  expect(c.reserves.note).toContain("Live needs a read made for this page");
});

test("a failed read for this page with an older good read: Not checked, naming the failure and the older read's age", () => {
  const c = byId(claimsFrom(stale(facts(), 300_000, "node is behind"), stale(reserves(), 300_000, "node is behind")));
  for (const id of CHAIN_CLAIMS) expect(c[id].status, id).toBe("unchecked");
  expect(c.deployed.note).toContain("failed: node is behind");
  expect(c.deployed.note).toContain("5 min old");
});

test("a failed read with nothing to fall back on: Not checked, with the reason", () => {
  const c = byId(claimsFrom(failed("could not reach api.devnet.solana.com"), failed("could not reach api.devnet.solana.com")));
  for (const id of CHAIN_CLAIMS) {
    expect(c[id].status, id).toBe("unchecked");
    expect(c[id].note, id).toContain("could not reach api.devnet.solana.com");
  }
});

test("a fresh read that shows no redeemed amount says Building, not Live", () => {
  const c = byId(claimsFrom(fresh(facts()), fresh(reserves("0"))));
  expect(c.redeemed.status).toBe("building");
});
