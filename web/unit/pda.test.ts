import { expect, test } from "@playwright/test";
import { decodeBase58 } from "../lib/base58";
import { PINS } from "../lib/pins";
import { ALLOWANCE_SEED, allowanceAddress, findProgramAddress, isOnCurve, u64BigEndian } from "../lib/pda";
import recorded from "./fixtures/devnet-watch.json";

// Program derived addresses (lib/pda.ts), checked against accounts the program created on
// devnet: the config and vault accounts in config/pins.json, and the demo allowance's address
// as devnet's own getProgramAccounts answered it (unit/fixtures/devnet-watch.json).

const text = (s: string) => new TextEncoder().encode(s);

test("the config account: seeds [\"config\"] (constants.rs CONFIG_SEED)", async () => {
  expect((await findProgramAddress([text("config")], PINS.programId)).address).toBe(PINS.accounts.config);
});

test("the vault account: seeds [\"vault\", mint] (constants.rs VAULT_SEED)", async () => {
  expect((await findProgramAddress([text("vault"), decodeBase58(PINS.mint)], PINS.programId)).address).toBe(PINS.accounts.vault);
});

test("an allowance account from its id: the address devnet's getProgramAccounts returned for that id", async () => {
  const id = BigInt(recorded.allowanceId);
  const found = recorded.getProgramAccounts.result;
  expect(found).toHaveLength(1);
  expect(await allowanceAddress(id, PINS.programId)).toBe(found[0].pubkey);
  expect(recorded.address).toBe(found[0].pubkey);
});

test("the allowance seed and the id's byte order follow open.rs (to_be_bytes)", () => {
  expect(Array.from(ALLOWANCE_SEED)).toEqual(Array.from(text("allowance")));
  expect(Array.from(u64BigEndian(BigInt("10652706154269594633")))).toEqual([0x93, 0xd6, 0x03, 0xce, 0x8d, 0xdb, 0x54, 0x09]);
  expect(Array.from(u64BigEndian(BigInt(1)))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  expect(() => u64BigEndian(BigInt(-1))).toThrow("not a u64");
  expect(() => u64BigEndian(BigInt(1) << BigInt(64))).toThrow("not a u64");
});

test("wallet addresses are on the curve; program derived addresses are not", () => {
  for (const wallet of [PINS.upgradeAuthority, PINS.feePayers.demo, PINS.feePayers.public, PINS.wallets.tableDemo]) {
    expect(isOnCurve(decodeBase58(wallet)), wallet).toBe(true);
  }
  for (const pda of [PINS.accounts.config, PINS.accounts.vault, recorded.address]) {
    expect(isOnCurve(decodeBase58(pda)), pda).toBe(false);
  }
  expect(() => isOnCurve(new Uint8Array(31))).toThrow("32 bytes");
});

test("seeds over the runtime's limits are refused", async () => {
  await expect(findProgramAddress([new Uint8Array(33)], PINS.programId)).rejects.toThrow("at most 32 bytes");
  await expect(findProgramAddress(Array.from({ length: 16 }, () => new Uint8Array(1)), PINS.programId)).rejects.toThrow("at most 15 seeds");
});
