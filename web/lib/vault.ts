// Decoders for the loka_vault program's accounts, events and instruction data, plus the
// loader and token accounts the pages read. Layouts follow programs/loka_vault/src/state.rs
// (Anchor borsh: an 8-byte discriminator, then fields in order, little-endian integers, a
// Vec as a u32 length then its items). The discriminators are sha256("account:<Name>"),
// sha256("event:<Name>") and sha256("global:<name>"), first 8 bytes; unit/vault.test.ts
// checks each against that rule and against programs/idl/loka_vault.json.
//
// Pure functions: no network, no framework. Amounts stay bigint here; the cached server
// reads turn them into decimal strings.

import { encodeBase58 } from "./base58";

export const ACCOUNT_DISCRIMINATORS = {
  Allowance: [144, 8, 184, 213, 49, 248, 73, 131],
  Merchant: [71, 235, 30, 40, 231, 21, 32, 64],
  VaultAuthority: [132, 34, 187, 202, 202, 195, 211, 53],
  VaultConfig: [99, 86, 43, 216, 184, 102, 119, 77],
} as const;

export type AccountName = keyof typeof ACCOUNT_DISCRIMINATORS;
export const ACCOUNT_NAMES = Object.keys(ACCOUNT_DISCRIMINATORS) as AccountName[];

export const EVENT_DISCRIMINATORS = {
  NoteRedeemed: [57, 237, 250, 78, 46, 209, 221, 34],
  Withdrawn: [20, 89, 223, 198, 194, 124, 219, 13],
} as const;

export const INSTRUCTION_DISCRIMINATORS = {
  initialize_vault: [48, 191, 163, 44, 71, 129, 63, 164],
  open_allowance: [233, 56, 143, 54, 62, 247, 107, 90],
  redeem_note: [214, 26, 188, 228, 39, 240, 25, 90],
  register_merchant: [238, 245, 77, 132, 161, 88, 216, 248],
  withdraw: [183, 18, 70, 156, 148, 109, 161, 34],
} as const;

export type InstructionName = keyof typeof INSTRUCTION_DISCRIMINATORS;

/** Devnet USDC has 6 decimals (programs/loka_vault/src/constants.rs MINT_DECIMALS). */
export const MINT_DECIMALS = 6;

export const BPF_UPGRADEABLE_LOADER = "BPFLoaderUpgradeab1e11111111111111111111111";
export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";

export class DecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecodeError";
  }
}

export function startsWith(data: Uint8Array, prefix: readonly number[]): boolean {
  if (data.length < prefix.length) return false;
  return prefix.every((b, i) => data[i] === b);
}

/** Sequential little-endian reader that throws DecodeError instead of reading past the end. */
class Reader {
  private offset: number;
  constructor(
    private readonly data: Uint8Array,
    start = 0,
    private readonly what = "account",
  ) {
    this.offset = start;
  }
  private take(n: number): Uint8Array {
    if (this.offset + n > this.data.length) {
      throw new DecodeError(`${this.what} is ${this.data.length} bytes, too short to read ${n} bytes at offset ${this.offset}`);
    }
    const out = this.data.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(): number {
    return this.take(1)[0];
  }
  u32(): number {
    const b = this.take(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16)) + b[3] * 0x1000000;
  }
  u64(): bigint {
    const b = this.take(8);
    let n = BigInt(0);
    for (let i = 7; i >= 0; i -= 1) n = (n << BigInt(8)) | BigInt(b[i]);
    return n;
  }
  i64(): bigint {
    const u = this.u64();
    return u >= BigInt(1) << BigInt(63) ? u - (BigInt(1) << BigInt(64)) : u;
  }
  bytes(n: number): Uint8Array {
    return Uint8Array.from(this.take(n));
  }
  pubkey(): string {
    return encodeBase58(this.take(32));
  }
  get position(): number {
    return this.offset;
  }
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function expectDiscriminator(data: Uint8Array, name: AccountName): void {
  if (!startsWith(data, ACCOUNT_DISCRIMINATORS[name])) {
    throw new DecodeError(`not a ${name} account (discriminator differs)`);
  }
}

// ---------- program accounts (state.rs) ----------

export interface Allowance {
  id: bigint;
  funder: string;
  payerKeyHex: string;
  cap: bigint;
  redeemed: bigint;
  offlineLimit: bigint;
  expiry: bigint;
  bond: bigint;
  earmarks: string[];
  usedSerialCount: number;
}

/** state.rs `Allowance`: id, funder, payer_key [33], cap, redeemed, offline_limit, expiry, bond, earmarks Vec<[u8;32]> (max 16), used_serials [32], bump. */
export function decodeAllowance(data: Uint8Array): Allowance {
  expectDiscriminator(data, "Allowance");
  const r = new Reader(data, 8, "Allowance account");
  const id = r.u64();
  const funder = r.pubkey();
  const payerKey = r.bytes(33);
  const cap = r.u64();
  const redeemed = r.u64();
  const offlineLimit = r.u64();
  const expiry = r.i64();
  const bond = r.u64();
  const count = r.u32();
  if (count > 16) throw new DecodeError(`Allowance has ${count} earmarks; state.rs allows at most 16`);
  const earmarks: string[] = [];
  for (let i = 0; i < count; i += 1) earmarks.push(toHex(r.bytes(32)));
  const used = r.bytes(32);
  r.u8(); // bump
  let usedSerialCount = 0;
  for (const byte of used) for (let bit = 0; bit < 8; bit += 1) usedSerialCount += (byte >> bit) & 1;
  return { id, funder, payerKeyHex: toHex(payerKey), cap, redeemed, offlineLimit, expiry, bond, earmarks, usedSerialCount };
}

export interface Merchant {
  publicKeyHex: string;
  keyHashHex: string;
  balance: bigint;
  withdrawCounter: bigint;
}

/** state.rs `Merchant`: public_key [33], key_hash [32], balance, withdraw_counter, bump. */
export function decodeMerchant(data: Uint8Array): Merchant {
  expectDiscriminator(data, "Merchant");
  const r = new Reader(data, 8, "Merchant account");
  const publicKey = r.bytes(33);
  const keyHash = r.bytes(32);
  const balance = r.u64();
  const withdrawCounter = r.u64();
  r.u8(); // bump
  return { publicKeyHex: toHex(publicKey), keyHashHex: toHex(keyHash), balance, withdrawCounter };
}

export interface VaultConfig {
  mint: string;
  cluster: number;
}

/** state.rs `VaultConfig`: mint, cluster (0 devnet, 1 mainnet), bump. */
export function decodeVaultConfig(data: Uint8Array): VaultConfig {
  expectDiscriminator(data, "VaultConfig");
  const r = new Reader(data, 8, "VaultConfig account");
  const mint = r.pubkey();
  const cluster = r.u8();
  r.u8(); // bump
  return { mint, cluster };
}

// ---------- token and loader accounts ----------

export interface TokenAccount {
  mint: string;
  owner: string;
  amount: bigint;
}

/** SPL Token account: mint (32), owner (32), amount (u64 little-endian) at the start of 165 bytes. */
export function decodeTokenAccount(data: Uint8Array): TokenAccount {
  if (data.length < 165) throw new DecodeError(`a token account is at least 165 bytes, not ${data.length}`);
  const r = new Reader(data, 0, "token account");
  return { mint: r.pubkey(), owner: r.pubkey(), amount: r.u64() };
}

/** Upgradeable loader `Program` account: u32 tag 2, then the program data address. */
export function decodeProgramAccount(data: Uint8Array): { programData: string } {
  const r = new Reader(data, 0, "program account");
  const tag = r.u32();
  if (tag !== 2) throw new DecodeError(`program account tag is ${tag}, not 2 (Program)`);
  return { programData: r.pubkey() };
}

/** Upgradeable loader `ProgramData` header (45 bytes): u32 tag 3, deploy slot u64, then Option<Pubkey> upgrade authority. */
export function decodeProgramDataHeader(data: Uint8Array): { slot: bigint; upgradeAuthority: string | null } {
  const r = new Reader(data, 0, "program data header");
  const tag = r.u32();
  if (tag !== 3) throw new DecodeError(`program data tag is ${tag}, not 3 (ProgramData)`);
  const slot = r.u64();
  const option = r.u8();
  if (option === 0) return { slot, upgradeAuthority: null };
  if (option !== 1) throw new DecodeError(`upgrade authority option byte is ${option}, not 0 or 1`);
  return { slot, upgradeAuthority: r.pubkey() };
}

/** Bytes before the program's ELF in its program data account. */
export const PROGRAM_DATA_HEADER_LEN = 45;

const LOADER_INSTRUCTIONS: Record<number, string> = {
  0: "InitializeBuffer",
  1: "Write",
  2: "DeployWithMaxDataLen",
  3: "Upgrade",
  4: "SetAuthority",
  5: "Close",
  6: "ExtendProgram",
  7: "SetAuthorityChecked",
};

/** The upgradeable loader's instruction name, from its u32 little-endian tag. */
export function decodeLoaderInstruction(data: Uint8Array): string {
  const tag = new Reader(data, 0, "loader instruction").u32();
  return LOADER_INSTRUCTIONS[tag] ?? `loader instruction ${tag}`;
}

// ---------- events (emitted with sol_log_data, "Program data: <base64>") ----------

export type VaultEvent =
  | { kind: "NoteRedeemed"; noteIdHex: string; allowanceId: bigint; serial: number; merchantKeyHashHex: string; amount: bigint }
  | { kind: "Withdrawn"; merchantKeyHashHex: string; destination: string; amount: bigint; counter: bigint };

/** Decodes a NoteRedeemed or Withdrawn event; null for any other data. Throws on a known event that is cut short. */
export function decodeEvent(data: Uint8Array): VaultEvent | null {
  if (startsWith(data, EVENT_DISCRIMINATORS.NoteRedeemed)) {
    const r = new Reader(data, 8, "NoteRedeemed event");
    return {
      kind: "NoteRedeemed",
      noteIdHex: toHex(r.bytes(32)),
      allowanceId: r.u64(),
      serial: r.u8(),
      merchantKeyHashHex: toHex(r.bytes(32)),
      amount: r.u64(),
    };
  }
  if (startsWith(data, EVENT_DISCRIMINATORS.Withdrawn)) {
    const r = new Reader(data, 8, "Withdrawn event");
    return {
      kind: "Withdrawn",
      merchantKeyHashHex: toHex(r.bytes(32)),
      destination: r.pubkey(),
      amount: r.u64(),
      counter: r.u64(),
    };
  }
  return null;
}

// ---------- instruction data ----------

export function instructionNameOf(data: Uint8Array): InstructionName | null {
  for (const [name, disc] of Object.entries(INSTRUCTION_DISCRIMINATORS)) {
    if (startsWith(data, disc)) return name as InstructionName;
  }
  return null;
}

export interface OpenAllowanceArgs {
  allowanceId: bigint;
  cap: bigint;
  offlineLimit: bigint;
  expiry: bigint;
  bond: bigint;
  earmarkCount: number;
}

/** state.rs `OpenAllowanceArgs` after the open_allowance discriminator. open.rs deposits cap + bond. */
export function decodeOpenAllowanceArgs(data: Uint8Array): OpenAllowanceArgs {
  if (!startsWith(data, INSTRUCTION_DISCRIMINATORS.open_allowance)) {
    throw new DecodeError("not open_allowance instruction data");
  }
  const r = new Reader(data, 8, "open_allowance data");
  const allowanceId = r.u64();
  r.bytes(33); // payer_key
  const cap = r.u64();
  const offlineLimit = r.u64();
  const expiry = r.i64();
  const bond = r.u64();
  const earmarkCount = r.u32();
  if (earmarkCount > 16) throw new DecodeError(`open_allowance names ${earmarkCount} earmarks; at most 16`);
  r.bytes(32 * earmarkCount);
  return { allowanceId, cap, offlineLimit, expiry, bond, earmarkCount };
}

// ---------- proof of reserves ----------

export interface Reserves {
  /** The vault's token account balance. */
  assets: bigint;
  allowanceCount: number;
  /** Sum over allowances of cap minus redeemed: what payers can still spend. */
  allowanceRemaining: bigint;
  /** Sum over allowances of bond. */
  bonds: bigint;
  merchantCount: number;
  /** Sum over merchant records of balance: credited by redeem_note, not yet withdrawn. */
  merchantBalances: bigint;
  liabilities: bigint;
  /** assets minus liabilities. Negative means the vault holds less than it owes. */
  difference: bigint;
  /** Allowance ids whose redeemed total exceeds the cap (redeem.rs forbids it; listed if seen). */
  anomalies: string[];
}

/**
 * Liabilities from the program's own rules: open.rs moves cap + bond into the vault;
 * redeem.rs adds a note's amount to the allowance's redeemed total and to the merchant's
 * balance without moving tokens; withdraw.rs pays a merchant balance out of the vault.
 * So the vault owes each allowance (cap - redeemed + bond) and each merchant its balance.
 */
export function computeReserves(assets: bigint, allowances: Allowance[], merchants: Merchant[]): Reserves {
  const zero = BigInt(0);
  let allowanceRemaining = zero;
  let bonds = zero;
  const anomalies: string[] = [];
  for (const a of allowances) {
    if (a.redeemed > a.cap) anomalies.push(a.id.toString());
    allowanceRemaining += a.cap - a.redeemed;
    bonds += a.bond;
  }
  let merchantBalances = zero;
  for (const m of merchants) merchantBalances += m.balance;
  const liabilities = allowanceRemaining + bonds + merchantBalances;
  return {
    assets,
    allowanceCount: allowances.length,
    allowanceRemaining,
    bonds,
    merchantCount: merchants.length,
    merchantBalances,
    liabilities,
    difference: assets - liabilities,
    anomalies,
  };
}

// ---------- display ----------

/**
 * Base units to a decimal string: at least 2 decimals, at most 6, trailing zeros past 2
 * removed. 1000000 is "1.00", 1500000 is "1.50", 1234567 is "1.234567".
 */
export function formatUnits(units: bigint | string, decimals = MINT_DECIMALS): string {
  const value = typeof units === "string" ? BigInt(units) : units;
  const negative = value < BigInt(0);
  const abs = negative ? -value : value;
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = abs / scale;
  let fraction = (abs % scale).toString().padStart(decimals, "0");
  while (fraction.length > 2 && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const wholeText = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${wholeText}.${fraction}`;
}

/** "InitializeVault" (as Anchor logs it) to "initialize_vault" (as the program names it). */
export function snakeCase(pascal: string): string {
  return pascal.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
}
