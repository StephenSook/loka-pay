// Devnet reads for /judge, /proof and /trust, cached for 30 seconds (lib/cached-read.ts).
// Server only. Every value here comes from the chain; config/pins.json only names the
// addresses to read and the values to compare against. Every call goes to the server's
// endpoint with the options from lib/server-rpc.ts (SOLANA_RPC_URL, never inlined into a page).
//
// Public devnet limits each method per IP (getProgramAccounts and getTransaction to 10
// calls per 10 seconds), refuses getProgramAccounts inside a JSON-RPC batch, and refuses a
// batch that repeats getAccountInfo or getTokenAccountBalance (measured 2026-10-10). So:
// the program's accounts are listed with ONE unfiltered getProgramAccounts call that
// returns only each account's first 8 bytes, its Anchor discriminator, and are counted by
// discriminator here; the fixed accounts are read together with getMultipleAccounts; a
// batch never names the same method twice.

import { cachedRead, type CachedReadOptions, type Read } from "./cached-read";
import { INIT_TX_SIGNATURE } from "./facts";
import { summarizeTransaction } from "./logs";
import { PINS } from "./pins";
import { serverReadOptions } from "./server-rpc";
import { RpcError, accountData, describeFailure, rpc, rpcBatch, unwrap, withContext, type RpcOptions, type RpcOutcome } from "./solana";
import {
  ACCOUNT_DISCRIMINATORS,
  ACCOUNT_NAMES,
  BPF_UPGRADEABLE_LOADER,
  MINT_DECIMALS,
  PROGRAM_DATA_HEADER_LEN,
  computeReserves,
  decodeAllowance,
  decodeMerchant,
  decodeProgramAccount,
  decodeProgramDataHeader,
  decodeTokenAccount,
  decodeVaultConfig,
  startsWith,
  type AccountName,
} from "./vault";

export type { FailedRead, Read } from "./cached-read";

export const REVALIDATE_SECONDS = 30;

/** One part of a read that may fail on its own; the page says which part and why. */
export type Part<T> = { ok: true; value: T } | { ok: false; reason: string };

function part<T>(outcome: RpcOutcome, decode: (result: unknown) => T): Part<T> {
  try {
    return { ok: true, value: decode(unwrap(outcome)) };
  } catch (e) {
    return { ok: false, reason: describeFailure(e) };
  }
}

interface AccountInfo {
  executable: boolean;
  owner: string;
  data: Uint8Array;
  space: number | null;
}

function accountInfo(value: unknown): AccountInfo | null {
  if (value === null) return null;
  const v = value as { executable?: unknown; owner?: unknown; data?: unknown; space?: unknown };
  if (typeof v.executable !== "boolean" || typeof v.owner !== "string") {
    throw new RpcError("shape", "an account answer had no owner or executable flag");
  }
  return { executable: v.executable, owner: v.owner, data: accountData(v.data), space: typeof v.space === "number" ? v.space : null };
}

export interface ProgramAccountList {
  slot: number;
  /** Addresses by account type, each list sorted. */
  byType: Record<AccountName, string[]>;
  /** Program-owned accounts whose discriminator is none of the program's account types. */
  other: string[];
}

/** Every account the program owns, grouped by Anchor discriminator, from one call. */
export async function listProgramAccounts(options: RpcOptions, minContextSlot?: number): Promise<ProgramAccountList> {
  const result = await rpc(
    "getProgramAccounts",
    [
      PINS.programId,
      {
        encoding: "base64",
        dataSlice: { offset: 0, length: 8 },
        withContext: true,
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      },
    ],
    options,
  );
  const { slot, value } = withContext(result);
  if (!Array.isArray(value)) throw new RpcError("shape", "getProgramAccounts did not answer a list");
  const byType = Object.fromEntries(ACCOUNT_NAMES.map((n) => [n, [] as string[]])) as Record<AccountName, string[]>;
  const other: string[] = [];
  for (const item of value as Array<{ pubkey?: unknown; account?: { data?: unknown } }>) {
    if (typeof item?.pubkey !== "string") throw new RpcError("shape", "a program account had no address");
    const head = accountData(item.account?.data);
    const name = ACCOUNT_NAMES.find((n) => startsWith(head, ACCOUNT_DISCRIMINATORS[n]));
    if (name) byType[name].push(item.pubkey);
    else other.push(item.pubkey);
  }
  for (const name of ACCOUNT_NAMES) byType[name].sort();
  return { slot, byType, other: other.sort() };
}

// ---------- program facts (/judge, /trust, /proof claims) ----------

export interface VaultTokenFacts {
  amountUnits: string;
  decimals: number;
  mint: string;
  owner: string;
  mintMatchesPins: boolean;
  ownerIsVault: boolean;
}

export interface ProgramFacts {
  /** The lowest and highest context slots among the answers. */
  slots: { min: number; max: number };
  program: { exists: boolean; executable: boolean; owner: string | null; programData: string | null };
  programData: Part<{
    deploySlot: number;
    deployTimeMs: number | null;
    upgradeAuthority: string | null;
    /** The program's ELF size: the account size minus the 45-byte header. */
    programBytes: number | null;
  }>;
  config: Part<{ exists: boolean; mint: string | null; cluster: number | null; mintMatchesPins: boolean }>;
  vault: Part<VaultTokenFacts>;
  counts: Part<{ byType: Record<AccountName, number>; other: number }>;
  init: Part<{ found: boolean; slot: number | null; blockTimeMs: number | null; failed: boolean; actions: string[] }>;
}

export async function readProgramFactsUncached(options: RpcOptions = serverReadOptions()): Promise<ProgramFacts> {
  const slots: number[] = [];
  const [batch, listed] = await Promise.all([
    rpcBatch(
      [
        {
          method: "getMultipleAccounts",
          params: [[PINS.programId, PINS.accounts.config, PINS.accounts.vaultUsdcAccount], { encoding: "base64" }],
        },
        { method: "getTokenAccountBalance", params: [PINS.accounts.vaultUsdcAccount] },
        {
          method: "getTransaction",
          params: [INIT_TX_SIGNATURE, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
        },
      ],
      options,
    ),
    listProgramAccounts(options).then(
      (value): Part<ProgramAccountList> => ({ ok: true, value }),
      (e): Part<ProgramAccountList> => ({ ok: false, reason: describeFailure(e) }),
    ),
  ]);
  const [accounts, balance, init] = batch;

  // The program account is the one read the page cannot do without.
  const accountsRead = withContext(unwrap(accounts));
  slots.push(accountsRead.slot);
  if (!Array.isArray(accountsRead.value) || accountsRead.value.length !== 3) {
    throw new RpcError("shape", "getMultipleAccounts answered the wrong number of accounts");
  }
  const [programInfo, configInfo, vaultInfo] = accountsRead.value.map(accountInfo);
  const programData =
    programInfo && programInfo.owner === BPF_UPGRADEABLE_LOADER ? decodeProgramAccount(programInfo.data).programData : null;

  let configPart: ProgramFacts["config"];
  try {
    if (!configInfo) {
      configPart = { ok: true, value: { exists: false, mint: null, cluster: null, mintMatchesPins: false } };
    } else {
      if (configInfo.owner !== PINS.programId) throw new RpcError("shape", "the config account is not owned by the program");
      const decoded = decodeVaultConfig(configInfo.data);
      configPart = {
        ok: true,
        value: { exists: true, mint: decoded.mint, cluster: decoded.cluster, mintMatchesPins: decoded.mint === PINS.mint },
      };
    }
  } catch (e) {
    configPart = { ok: false, reason: describeFailure(e) };
  }

  const vaultPart = part(balance, (result) => {
    const { slot, value } = withContext(result);
    slots.push(slot);
    const v = value as { amount?: unknown; decimals?: unknown };
    if (typeof v?.amount !== "string" || !/^\d+$/.test(v.amount) || typeof v.decimals !== "number") {
      throw new RpcError("shape", "getTokenAccountBalance answered no amount");
    }
    if (!vaultInfo) throw new RpcError("shape", "the vault token account does not exist");
    const token = decodeTokenAccount(vaultInfo.data);
    return {
      amountUnits: v.amount,
      decimals: v.decimals,
      mint: token.mint,
      owner: token.owner,
      mintMatchesPins: token.mint === PINS.mint,
      ownerIsVault: token.owner === PINS.accounts.vault,
    };
  });

  let countsPart: ProgramFacts["counts"];
  if (listed.ok) {
    slots.push(listed.value.slot);
    const byType = Object.fromEntries(ACCOUNT_NAMES.map((n) => [n, listed.value.byType[n].length])) as Record<AccountName, number>;
    countsPart = { ok: true, value: { byType, other: listed.value.other.length } };
  } else {
    countsPart = listed;
  }

  const initPart = part(init, (result) => {
    if (result === null) return { found: false, slot: null, blockTimeMs: null, failed: false, actions: [] };
    const summary = summarizeTransaction(result, PINS.programId);
    if (!summary) throw new RpcError("shape", "the initialize transaction answer had an unexpected shape");
    return {
      found: true,
      slot: summary.slot,
      blockTimeMs: summary.blockTime === null ? null : summary.blockTime * 1000,
      failed: summary.failed,
      actions: summary.actions,
    };
  });

  let programDataPart: ProgramFacts["programData"] = { ok: false, reason: "the program account names no program data" };
  if (programData) {
    try {
      const read = withContext(
        await rpc("getAccountInfo", [programData, { encoding: "base64", dataSlice: { offset: 0, length: PROGRAM_DATA_HEADER_LEN } }], options),
      );
      slots.push(read.slot);
      const info = accountInfo(read.value);
      if (!info) throw new RpcError("shape", "the program data account does not exist");
      const decoded = decodeProgramDataHeader(info.data);
      const deploySlot = Number(decoded.slot);
      let deployTimeMs: number | null = null;
      try {
        const blockTime = await rpc("getBlockTime", [deploySlot], options);
        if (typeof blockTime === "number") deployTimeMs = blockTime * 1000;
      } catch {
        // Shown as "block time not read".
      }
      programDataPart = {
        ok: true,
        value: {
          deploySlot,
          deployTimeMs,
          upgradeAuthority: decoded.upgradeAuthority,
          programBytes: info.space === null ? null : info.space - PROGRAM_DATA_HEADER_LEN,
        },
      };
    } catch (e) {
      programDataPart = { ok: false, reason: describeFailure(e) };
    }
  }

  return {
    slots: { min: Math.min(...slots), max: Math.max(...slots) },
    program: {
      exists: programInfo !== null,
      executable: programInfo?.executable ?? false,
      owner: programInfo?.owner ?? null,
      programData,
    },
    programData: programDataPart,
    config: configPart,
    vault: vaultPart,
    counts: countsPart,
    init: initPart,
  };
}

/** `readFirst` for a page whose claims say Live: a read made for this page view (lib/cached-read.ts). */
export function readProgramFacts(options: CachedReadOptions = {}): Promise<Read<ProgramFacts>> {
  return cachedRead(`program-facts:${PINS.programId}`, REVALIDATE_SECONDS, () => readProgramFactsUncached(), options);
}

// ---------- proof of reserves (/proof, PLAN.md 3.24) ----------

export interface ReservesRead {
  /** Every balance below was read in one getMultipleAccounts call at this slot. */
  slot: number;
  /** The slots at which the account list was taken and then checked again. */
  listedAt: { first: number; check: number };
  vault: VaultTokenFacts;
  allowances: Array<{ address: string; id: string; capUnits: string; redeemedUnits: string; bondUnits: string; expiry: string }>;
  merchants: Array<{ address: string; keyHashHex: string; balanceUnits: string }>;
  totals: {
    assets: string;
    allowanceRemaining: string;
    bonds: string;
    merchantBalances: string;
    liabilities: string;
    difference: string;
  };
  anomalies: string[];
}

/** getMultipleAccounts takes at most 100 addresses; one is the vault token account. */
const MAX_ONE_SLOT = 99;

const sameList = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

export async function readReservesUncached(options: RpcOptions = serverReadOptions()): Promise<ReservesRead> {
  let listed = await listProgramAccounts(options);
  // Program accounts are never closed (the program has no close instruction), so if the
  // list taken again at or after the balances' slot is unchanged, the balances cover
  // every account that existed at that slot. One retry if an account appeared in between.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const allowanceAddresses = listed.byType.Allowance;
    const merchantAddresses = listed.byType.Merchant;
    const addresses = [PINS.accounts.vaultUsdcAccount, ...allowanceAddresses, ...merchantAddresses];
    if (addresses.length - 1 > MAX_ONE_SLOT) {
      throw new Error(
        `the program has ${addresses.length - 1} allowance and merchant accounts; this page reads at most ${MAX_ONE_SLOT} at one slot`,
      );
    }
    const { slot, value } = withContext(await rpc("getMultipleAccounts", [addresses, { encoding: "base64" }], options));
    if (!Array.isArray(value) || value.length !== addresses.length) {
      throw new RpcError("shape", "getMultipleAccounts answered the wrong number of accounts");
    }
    let check: ProgramAccountList;
    try {
      check = await listProgramAccounts(options, slot);
    } catch (e) {
      // A node still behind the balances' slot refuses minContextSlot; ask once more.
      if (!(e instanceof RpcError && e.kind === "rpc")) throw e;
      await new Promise((resolve) => setTimeout(resolve, 600));
      check = await listProgramAccounts(options, slot);
    }
    if (!sameList(check.byType.Allowance, allowanceAddresses) || !sameList(check.byType.Merchant, merchantAddresses)) {
      listed = check;
      continue;
    }

    const infos = value.map(accountInfo);
    const vaultInfo = infos[0];
    if (!vaultInfo) throw new RpcError("shape", "the vault token account does not exist");
    const token = decodeTokenAccount(vaultInfo.data);
    const allowances = infos.slice(1, 1 + allowanceAddresses.length).map((info, i) => {
      if (!info || info.owner !== PINS.programId) throw new RpcError("shape", `allowance ${allowanceAddresses[i]} is missing`);
      return decodeAllowance(info.data);
    });
    const merchants = infos.slice(1 + allowanceAddresses.length).map((info, i) => {
      if (!info || info.owner !== PINS.programId) throw new RpcError("shape", `merchant ${merchantAddresses[i]} is missing`);
      return decodeMerchant(info.data);
    });
    const r = computeReserves(token.amount, allowances, merchants);
    return {
      slot,
      listedAt: { first: listed.slot, check: check.slot },
      vault: {
        amountUnits: token.amount.toString(),
        decimals: MINT_DECIMALS,
        mint: token.mint,
        owner: token.owner,
        mintMatchesPins: token.mint === PINS.mint,
        ownerIsVault: token.owner === PINS.accounts.vault,
      },
      allowances: allowances.map((a, i) => ({
        address: allowanceAddresses[i],
        id: a.id.toString(),
        capUnits: a.cap.toString(),
        redeemedUnits: a.redeemed.toString(),
        bondUnits: a.bond.toString(),
        expiry: a.expiry.toString(),
      })),
      merchants: merchants.map((m, i) => ({
        address: merchantAddresses[i],
        keyHashHex: m.keyHashHex,
        balanceUnits: m.balance.toString(),
      })),
      totals: {
        assets: r.assets.toString(),
        allowanceRemaining: r.allowanceRemaining.toString(),
        bonds: r.bonds.toString(),
        merchantBalances: r.merchantBalances.toString(),
        liabilities: r.liabilities.toString(),
        difference: r.difference.toString(),
      },
      anomalies: r.anomalies,
    };
  }
  throw new Error("program accounts kept changing during the read; reload to try again");
}

/** `readFirst` for a page whose claims say Live: a read made for this page view (lib/cached-read.ts). */
export function readReserves(options: CachedReadOptions = {}): Promise<Read<ReservesRead>> {
  return cachedRead(`reserves:${PINS.programId}`, REVALIDATE_SECONDS, () => readReservesUncached(), options);
}
