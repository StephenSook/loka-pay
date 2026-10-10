import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { PINS } from "../lib/pins";
import {
  ACCOUNT_DISCRIMINATORS,
  DecodeError,
  EVENT_DISCRIMINATORS,
  INSTRUCTION_DISCRIMINATORS,
  computeReserves,
  decodeAllowance,
  decodeEvent,
  decodeLoaderInstruction,
  decodeMerchant,
  decodeOpenAllowanceArgs,
  decodeProgramAccount,
  decodeProgramDataHeader,
  decodeTokenAccount,
  decodeVaultConfig,
  formatUnits,
  instructionNameOf,
  snakeCase,
} from "../lib/vault";
import { concat, filled, fromBase64, le32, le64, padTo, pubkey, sha256Prefix } from "./bytes";

// Decoders for programs/loka_vault/src/state.rs. Hand-built bytes are TEST FIXTURES that
// follow the struct layouts field by field; the "recorded" bytes are real devnet accounts
// read with getAccountInfo on 2026-10-10 (slots noted beside each).

const idl = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "programs", "idl", "loka_vault.json"), "utf8"));

const ALLOWANCE_SIZE = 670; // 8 + Allowance::INIT_SPACE (earmarks allocated at 16)
const MERCHANT_SIZE = 90; // 8 + Merchant::INIT_SPACE

const FUNDER = "8Y8P1qp7oMJUmSSXkYRmDuhPhfypjU5sLMjMWQ5qB8c";

function allowanceBytes(fields: {
  id: bigint;
  cap: bigint;
  redeemed: bigint;
  offlineLimit: bigint;
  expiry: bigint;
  bond: bigint;
  earmarks: Uint8Array[];
  used: Uint8Array;
}): Uint8Array {
  return padTo(
    concat(
      [...ACCOUNT_DISCRIMINATORS.Allowance],
      le64(fields.id),
      pubkey(FUNDER),
      concat([0x02], filled(32, 0x11)), // payer_key, compressed P-256
      le64(fields.cap),
      le64(fields.redeemed),
      le64(fields.offlineLimit),
      le64(fields.expiry),
      le64(fields.bond),
      le32(fields.earmarks.length),
      ...fields.earmarks,
      fields.used,
      [254], // bump
    ),
    ALLOWANCE_SIZE,
  );
}

function merchantBytes(balance: bigint, counter: bigint): Uint8Array {
  return padTo(
    concat([...ACCOUNT_DISCRIMINATORS.Merchant], concat([0x03], filled(32, 0x22)), filled(32, 0x33), le64(balance), le64(counter), [253]),
    MERCHANT_SIZE,
  );
}

test.describe("discriminators", () => {
  for (const [name, bytes] of Object.entries(ACCOUNT_DISCRIMINATORS)) {
    test(`account ${name} is sha256("account:${name}") and matches the committed IDL`, () => {
      expect([...bytes]).toEqual(sha256Prefix(`account:${name}`));
      const fromIdl = idl.accounts.find((a: { name: string }) => a.name === name);
      expect(fromIdl?.discriminator).toEqual([...bytes]);
    });
  }
  for (const [name, bytes] of Object.entries(EVENT_DISCRIMINATORS)) {
    test(`event ${name} is sha256("event:${name}") and matches the committed IDL`, () => {
      expect([...bytes]).toEqual(sha256Prefix(`event:${name}`));
      expect(idl.events.find((e: { name: string }) => e.name === name)?.discriminator).toEqual([...bytes]);
    });
  }
  for (const [name, bytes] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    test(`instruction ${name} is sha256("global:${name}") and matches the committed IDL`, () => {
      expect([...bytes]).toEqual(sha256Prefix(`global:${name}`));
      expect(idl.instructions.find((i: { name: string }) => i.name === name)?.discriminator).toEqual([...bytes]);
    });
  }
  test("the IDL lists no account, event or instruction this page does not know", () => {
    expect(idl.accounts.map((a: { name: string }) => a.name).sort()).toEqual(Object.keys(ACCOUNT_DISCRIMINATORS).sort());
    expect(idl.events.map((e: { name: string }) => e.name).sort()).toEqual(Object.keys(EVENT_DISCRIMINATORS).sort());
    expect(idl.instructions.map((i: { name: string }) => i.name).sort()).toEqual(Object.keys(INSTRUCTION_DISCRIMINATORS).sort());
  });
  test("the IDL's struct fields are the ones the decoders read, in order", () => {
    const fields = (name: string) =>
      idl.types.find((t: { name: string }) => t.name === name).type.fields.map((f: { name: string }) => f.name);
    expect(fields("Allowance")).toEqual([
      "id", "funder", "payer_key", "cap", "redeemed", "offline_limit", "expiry", "bond", "earmarks", "used_serials", "bump",
    ]);
    expect(fields("Merchant")).toEqual(["public_key", "key_hash", "balance", "withdraw_counter", "bump"]);
    expect(fields("VaultConfig")).toEqual(["mint", "cluster", "bump"]);
    expect(fields("NoteRedeemed")).toEqual(["note_id", "allowance_id", "serial", "merchant_key_hash", "amount"]);
    expect(fields("Withdrawn")).toEqual(["merchant_key_hash", "destination", "amount", "counter"]);
  });
});

test.describe("Allowance (test fixture bytes)", () => {
  test("decodes every field, with two earmarks and three used serials", () => {
    const used = new Uint8Array(32);
    used[0] = 0b0000_0101; // serials 0 and 2
    used[31] = 0b1000_0000; // serial 255
    const data = allowanceBytes({
      id: BigInt("18446744073709551615"),
      cap: BigInt(5_000_000),
      redeemed: BigInt(1_250_000),
      offlineLimit: BigInt(2_000_000),
      expiry: BigInt(1_760_400_000),
      bond: BigInt(500_000),
      earmarks: [filled(32, 0xaa), filled(32, 0xbb)],
      used,
    });
    expect(data.length).toBe(ALLOWANCE_SIZE);
    const a = decodeAllowance(data);
    expect(a.id).toBe(BigInt("18446744073709551615"));
    expect(a.funder).toBe(FUNDER);
    expect(a.payerKeyHex).toBe(`02${"11".repeat(32)}`);
    expect(a.cap).toBe(BigInt(5_000_000));
    expect(a.redeemed).toBe(BigInt(1_250_000));
    expect(a.offlineLimit).toBe(BigInt(2_000_000));
    expect(a.expiry).toBe(BigInt(1_760_400_000));
    expect(a.bond).toBe(BigInt(500_000));
    expect(a.earmarks).toEqual(["aa".repeat(32), "bb".repeat(32)]);
    expect(a.usedSerialCount).toBe(3);
  });

  test("a negative expiry reads as a signed i64", () => {
    const a = decodeAllowance(
      allowanceBytes({
        id: BigInt(1),
        cap: BigInt(1),
        redeemed: BigInt(0),
        offlineLimit: BigInt(1),
        expiry: BigInt(-1),
        bond: BigInt(0),
        earmarks: [],
        used: new Uint8Array(32),
      }),
    );
    expect(a.expiry).toBe(BigInt(-1));
  });

  test("refuses a Merchant account, more than 16 earmarks, and cut-short data", () => {
    expect(() => decodeAllowance(merchantBytes(BigInt(0), BigInt(0)))).toThrow(DecodeError);
    const tooMany = concat([...ACCOUNT_DISCRIMINATORS.Allowance], new Uint8Array(113), le32(17));
    expect(() => decodeAllowance(padTo(tooMany, ALLOWANCE_SIZE))).toThrow(/at most 16/);
    expect(() => decodeAllowance(Uint8Array.from(ACCOUNT_DISCRIMINATORS.Allowance))).toThrow(/too short/);
  });
});

test.describe("Merchant and VaultConfig", () => {
  test("Merchant (test fixture bytes) decodes balance and counter", () => {
    const m = decodeMerchant(merchantBytes(BigInt(1_500_000), BigInt(3)));
    expect(m.publicKeyHex).toBe(`03${"22".repeat(32)}`);
    expect(m.keyHashHex).toBe("33".repeat(32));
    expect(m.balance).toBe(BigInt(1_500_000));
    expect(m.withdrawCounter).toBe(BigInt(3));
  });

  test("VaultConfig recorded from devnet (slot 509435492): devnet USDC mint, cluster 0", () => {
    const c = decodeVaultConfig(fromBase64("Y1Yr2Lhmd007RCyzkSFX8TqTPQE0KC0DK1/+zQGi2/G3eQYI3wAupwD/"));
    expect(c.mint).toBe(PINS.mint);
    expect(c.cluster).toBe(0);
  });
});

test.describe("loader and token accounts recorded from devnet", () => {
  test("program account (slot 509438547) names its program data address", () => {
    expect(decodeProgramAccount(fromBase64("AgAAAPOfamYx1Hb+XVcJg0Th6WBZANoTO94XH67q6RpPnXGG"))).toEqual({
      programData: "HQ14Pvsp9H9MH6TuzL5fiwzP3gtHwRe47bXAWUzoo3L1",
    });
  });

  test("program data header (slot 509435491): deploy slot and upgrade authority", () => {
    const header = decodeProgramDataHeader(fromBase64("AwAAAHRCXR4AAAAAATLfRFizkonNStVSJDm2BbGSiy56wAnJq6stP3adi/Xh"));
    expect(header.slot).toBe(BigInt(509428340));
    expect(header.upgradeAuthority).toBe(PINS.upgradeAuthority);
  });

  test("program data header with no authority (test fixture) reads as frozen", () => {
    expect(decodeProgramDataHeader(concat(le32(3), le64(7), [0])).upgradeAuthority).toBeNull();
    expect(() => decodeProgramDataHeader(concat(le32(2), le64(7), [0]))).toThrow(/not 3/);
    expect(() => decodeProgramDataHeader(concat(le32(3), le64(7), [2]))).toThrow(/option byte/);
  });

  test("vault token account (slot 509438548): pinned mint, owned by the vault PDA, empty", () => {
    const token = decodeTokenAccount(
      fromBase64(
        "O0Qss5EhV/E6kz0BNCgtAytf/s0Botvxt3kGCN8ALqdzNp/k+e+644t1GOlCTlH0gLLSM9ZTOLX/a9/Z8ehccwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      ),
    );
    expect(token.mint).toBe(PINS.mint);
    expect(token.owner).toBe(PINS.accounts.vault);
    expect(token.amount).toBe(BigInt(0));
  });

  test("token account amount (test fixture) reads little-endian", () => {
    const data = padTo(concat(pubkey(PINS.mint), pubkey(PINS.accounts.vault), le64(BigInt("12345678901234"))), 165);
    expect(decodeTokenAccount(data).amount).toBe(BigInt("12345678901234"));
    expect(() => decodeTokenAccount(data.subarray(0, 100))).toThrow(DecodeError);
  });

  test("loader instruction tags", () => {
    expect(decodeLoaderInstruction(concat(le32(2), le64(0)))).toBe("DeployWithMaxDataLen");
    expect(decodeLoaderInstruction(le32(3))).toBe("Upgrade");
    expect(decodeLoaderInstruction(le32(4))).toBe("SetAuthority");
    expect(decodeLoaderInstruction(le32(99))).toBe("loader instruction 99");
  });
});

test.describe("events and instruction data (test fixture bytes)", () => {
  test("NoteRedeemed", () => {
    const data = concat([...EVENT_DISCRIMINATORS.NoteRedeemed], filled(32, 0x44), le64(17), [9], filled(32, 0x55), le64(1_000_000));
    expect(decodeEvent(data)).toEqual({
      kind: "NoteRedeemed",
      noteIdHex: "44".repeat(32),
      allowanceId: BigInt(17),
      serial: 9,
      merchantKeyHashHex: "55".repeat(32),
      amount: BigInt(1_000_000),
    });
  });

  test("Withdrawn", () => {
    const data = concat([...EVENT_DISCRIMINATORS.Withdrawn], filled(32, 0x66), pubkey(FUNDER), le64(250_000), le64(4));
    expect(decodeEvent(data)).toEqual({
      kind: "Withdrawn",
      merchantKeyHashHex: "66".repeat(32),
      destination: FUNDER,
      amount: BigInt(250_000),
      counter: BigInt(4),
    });
  });

  test("other data is not an event; a cut-short event throws", () => {
    expect(decodeEvent(filled(40, 1))).toBeNull();
    expect(() => decodeEvent(concat([...EVENT_DISCRIMINATORS.Withdrawn], filled(10, 0)))).toThrow(DecodeError);
  });

  test("open_allowance arguments: deposit is cap plus bond", () => {
    const data = concat(
      [...INSTRUCTION_DISCRIMINATORS.open_allowance],
      le64(42),
      concat([0x02], filled(32, 0x77)),
      le64(5_000_000),
      le64(2_000_000),
      le64(1_760_400_000),
      le64(100_000),
      le32(1),
      filled(32, 0x88),
    );
    expect(instructionNameOf(data)).toBe("open_allowance");
    expect(decodeOpenAllowanceArgs(data)).toEqual({
      allowanceId: BigInt(42),
      cap: BigInt(5_000_000),
      offlineLimit: BigInt(2_000_000),
      expiry: BigInt(1_760_400_000),
      bond: BigInt(100_000),
      earmarkCount: 1,
    });
    expect(() => decodeOpenAllowanceArgs(data.subarray(0, 60))).toThrow(DecodeError);
    expect(instructionNameOf(filled(8, 0))).toBeNull();
  });
});

test.describe("proof of reserves", () => {
  const allowance = (cap: number, redeemed: number, bond: number) =>
    decodeAllowance(
      allowanceBytes({
        id: BigInt(cap),
        cap: BigInt(cap),
        redeemed: BigInt(redeemed),
        offlineLimit: BigInt(0),
        expiry: BigInt(0),
        bond: BigInt(bond),
        earmarks: [],
        used: new Uint8Array(32),
      }),
    );

  test("today's devnet state: no allowances, no merchants, empty vault", () => {
    const r = computeReserves(BigInt(0), [], []);
    expect(r.liabilities).toBe(BigInt(0));
    expect(r.difference).toBe(BigInt(0));
    expect(r.allowanceCount).toBe(0);
    expect(r.merchantCount).toBe(0);
  });

  test("open, redeem and withdraw keep assets equal to liabilities (test ledger)", () => {
    // open_allowance: cap 5.00 + bond 0.50 into the vault.
    let assets = BigInt(5_500_000);
    expect(computeReserves(assets, [allowance(5_000_000, 0, 500_000)], []).difference).toBe(BigInt(0));
    // redeem_note 1.25 to a merchant: no tokens move.
    expect(
      computeReserves(assets, [allowance(5_000_000, 1_250_000, 500_000)], [decodeMerchant(merchantBytes(BigInt(1_250_000), BigInt(0)))]),
    ).toMatchObject({ allowanceRemaining: BigInt(3_750_000), bonds: BigInt(500_000), merchantBalances: BigInt(1_250_000), difference: BigInt(0) });
    // withdraw 1.00 of the merchant's balance: tokens leave the vault.
    assets -= BigInt(1_000_000);
    const r = computeReserves(assets, [allowance(5_000_000, 1_250_000, 500_000)], [decodeMerchant(merchantBytes(BigInt(250_000), BigInt(1)))]);
    expect(r.liabilities).toBe(BigInt(4_500_000));
    expect(r.difference).toBe(BigInt(0));
  });

  test("a shortfall is negative and a redeemed total over the cap is listed", () => {
    const r = computeReserves(BigInt(1), [allowance(10, 11, 0)], []);
    expect(r.difference).toBe(BigInt(2));
    expect(r.anomalies).toEqual(["10"]);
    expect(computeReserves(BigInt(0), [allowance(10, 0, 0)], []).difference).toBe(BigInt(-10));
  });
});

test.describe("display helpers", () => {
  test("formatUnits", () => {
    expect(formatUnits(BigInt(0))).toBe("0.00");
    expect(formatUnits(BigInt(1_000_000))).toBe("1.00");
    expect(formatUnits(BigInt(1_500_000))).toBe("1.50");
    expect(formatUnits(BigInt(1_234_567))).toBe("1.234567");
    expect(formatUnits("1234567000000")).toBe("1,234,567.00");
    expect(formatUnits(BigInt(-2_500_000))).toBe("-2.50");
    expect(formatUnits(BigInt(1))).toBe("0.000001");
  });

  test("snakeCase", () => {
    expect(snakeCase("InitializeVault")).toBe("initialize_vault");
    expect(snakeCase("OpenAllowance")).toBe("open_allowance");
    expect(snakeCase("Withdraw")).toBe("withdraw");
  });
});
