import { expect, test } from "@playwright/test";
import { parseTokenBalance } from "../lib/chain";
import { summarizeTransaction } from "../lib/logs";
import { PINS } from "../lib/pins";
import { detailOutcome, loadSignatures } from "../lib/program-feed";
import { formatEt, isUnixSeconds } from "../lib/time";
import { formatUnits } from "../lib/vault";

// Numbers a node sends are checked where they are decoded, so a page never receives a value
// that throws while it renders (formatUnits on fractional decimals, a Date out of range).
// Every answer here is a TEST FIXTURE.

const P = PINS.programId;

test.describe("token balance decimals", () => {
  test("a whole number from 0 to 255 is accepted and formats", () => {
    const b = parseTokenBalance({ amount: "7000000", decimals: 6, uiAmount: 7 });
    expect(b).toEqual({ amountUnits: "7000000", decimals: 6 });
    expect(formatUnits(b.amountUnits, b.decimals)).toBe("7.00");
    expect(parseTokenBalance({ amount: "1", decimals: 0 }).decimals).toBe(0);
    expect(parseTokenBalance({ amount: "1", decimals: 255 }).decimals).toBe(255);
  });

  test("fractional, negative, too large or non-number decimals are refused at the read", () => {
    // What a page would have hit: formatUnits throws on fractional decimals.
    expect(() => formatUnits("1", 6.5)).toThrow(RangeError);
    for (const decimals of [6.5, -1, 256, Number.NaN, Number.POSITIVE_INFINITY, "6", null]) {
      expect(() => parseTokenBalance({ amount: "7000000", decimals }), String(decimals)).toThrow(/decimals that are not a whole number/);
    }
    expect(() => parseTokenBalance({ amount: "7.5", decimals: 6 })).toThrow(/no amount/);
    expect(() => parseTokenBalance(null)).toThrow(/no amount/);
  });
});

test.describe("block times", () => {
  test("a showable Unix time is a non-negative safe integer a Date can hold", () => {
    expect(isUnixSeconds(1_791_700_000)).toBe(true);
    expect(isUnixSeconds(0)).toBe(true);
    expect(isUnixSeconds(8_640_000_000_000)).toBe(true);
    for (const v of [8_640_000_000_001, 1e20, 1.5, -1, Number.NaN, "1791700000", null, undefined]) expect(isUnixSeconds(v), String(v)).toBe(false);
    // What a page would have hit: a Date out of range throws when formatted.
    expect(() => formatEt(1e20 * 1000)).toThrow(RangeError);
  });

  const tx = (blockTime: unknown) => ({
    slot: 604,
    blockTime,
    meta: { err: null, logMessages: [`Program ${P} invoke [1]`, "Program log: Instruction: RedeemNote", `Program ${P} success`] },
    transaction: { signatures: ["fixture-time"], message: { accountKeys: [P], instructions: [] } },
  });

  test("a transaction answer with an impossible block time is unavailable, never rendered", () => {
    for (const bt of [1e20, 1.5, -5, "1791700000"]) {
      expect(summarizeTransaction(tx(bt), P), String(bt)).toBeNull();
      expect(detailOutcome({ ok: true, result: tx(bt) }, P).kind, String(bt)).toBe("unavailable");
    }
    expect(summarizeTransaction(tx(null), P)?.blockTime).toBeNull();
    expect(summarizeTransaction(tx(1_791_700_000), P)?.blockTime).toBe(1_791_700_000);
  });

  test("a signature list with an impossible block time is refused as a whole", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ jsonrpc: "2.0", id: 0, result: [{ signature: "fixture-sig", slot: 600_000_000, err: null, blockTime: 1e20 }] }),
        { headers: { "content-type": "application/json" } },
      )) as typeof fetch;
    try {
      await expect(loadSignatures(P)).rejects.toThrow(/unexpected shape/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
