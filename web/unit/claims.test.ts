import { expect, test } from "@playwright/test";
import type { ProgramFacts, ReservesRead } from "../lib/chain";
import { claimsFrom, type Claim } from "../lib/claims";
import { PINS } from "../lib/pins";
import type { Read } from "../lib/read-state";

// The /proof claims (lib/claims.ts). The reads below are TEST FIXTURES shaped like what
// lib/chain.ts returns; only the fields the claims read matter. A claim says Live only from
// a current read (younger than its window), and then carries that read's time and age; a
// failed, stale or older cached read leaves it Not checked.

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

const CURRENT_FOR = 10_000;
const fresh = <T>(data: T, ageMs = 0): Read<T> => ({
  ok: true,
  data,
  readAtMs: NOW - ageMs,
  staleBecause: null,
  current: true,
  askedAtMs: NOW,
  currentForMs: CURRENT_FOR,
});
const cached = <T>(data: T, ageMs: number): Read<T> => ({
  ok: true,
  data,
  readAtMs: NOW - ageMs,
  staleBecause: null,
  current: false,
  askedAtMs: NOW,
  currentForMs: CURRENT_FOR,
});
const stale = <T>(data: T, ageMs: number, reason: string, notMade = false): Read<T> => ({
  ok: true,
  data,
  readAtMs: NOW - ageMs,
  staleBecause: notMade ? { reason, atMs: NOW, notMade: true } : { reason, atMs: NOW },
  current: false,
  askedAtMs: NOW,
  currentForMs: CURRENT_FOR,
});
const failed = <T>(reason: string): Read<T> => ({ ok: false, reason, atMs: NOW });

const byId = (claims: Claim[]) => Object.fromEntries(claims.map((c) => [c.id, c]));
const CHAIN_CLAIMS = ["deployed", "initialized", "reserves", "redeemed"];

test("current reads make the chain claims Live, each with its evidence and the read's time and exact age", () => {
  const c = byId(claimsFrom(fresh(facts(), 4_000), fresh(reserves(), 0)));
  for (const id of CHAIN_CLAIMS) {
    expect(c[id].status, id).toBe("live");
    expect(c[id].evidence, id).toBeDefined();
  }
  expect(c.deployed.checked).toEqual({ source: "Solana devnet", readAtMs: NOW - 4_000, ageMs: 4_000 });
  expect(c.redeemed.checked).toEqual({ source: "Solana devnet", readAtMs: NOW, ageMs: 0 });
  // A claim no read decides carries no read stamp.
  expect(c.verify.checked).toBeUndefined();
});

test("a cached read older than the window never makes a claim Live: Not checked, with the read's age", () => {
  const c = byId(claimsFrom(cached(facts(), 60_000), cached(reserves(), 12_000)));
  for (const id of CHAIN_CLAIMS) {
    expect(c[id].status, id).toBe("unchecked");
    expect(c[id].checked, id).toBeUndefined();
  }
  expect(c.deployed.note).toContain("was 60 s old");
  expect(c.reserves.note).toContain("was 12 s old");
  expect(c.reserves.note).toContain("a Live claim needs one no older than 10 s");
});

test("a read not made (budget or rate-limit pause) says so, with the last good read's age", () => {
  const reason = "the last read was rate limited, so this server waits 8 s more before reading again";
  const c = byId(claimsFrom(stale(facts(), 25_000, reason, true), stale(reserves(), 25_000, reason, true)));
  for (const id of CHAIN_CLAIMS) expect(c[id].status, id).toBe("unchecked");
  expect(c.deployed.note).toContain(`was not made: ${reason}`);
  expect(c.deployed.note).toContain("was 25 s old");
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
