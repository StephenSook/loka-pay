// Devnet reads for /judge, /proof and /trust, cached for 30 seconds (lib/cached-read.ts).
// Server only. Every value here comes from the chain; config/pins.json only names the
// addresses to read and the values to compare against.

import { encodeBase58 } from "./base58";
import { cachedRead, type Read } from "./cached-read";
import { INIT_TX_SIGNATURE } from "./facts";
import { summarizeTransaction } from "./logs";
import { PINS } from "./pins";
import { RpcError, accountData, describeFailure, rpcBatch, unwrap, withContext, type RpcOutcome } from "./solana";
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
  type AccountName,
} from "./vault";

export type { Read } from "./cached-read";

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
    throw new RpcError("shape", "account answer had no owner or executable flag");
  }
  return { executable: v.executable, owner: v.owner, data: accountData(v.data), space: typeof v.space === "number" ? v.space : null };
}

function discriminatorFilter(name: AccountName) {
  return { memcmp: { offset: 0, bytes: encodeBase58(Uint8Array.from(ACCOUNT_DISCRIMINATORS[name])) } };
}

/** getProgramAccounts for one account type, addresses only (no data), with its context slot. */
function listAccounts(name: AccountName, minContextSlot?: number) {
  return {
    method: "getProgramAccounts",
    params: [
      PINS.programId,
      {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
        filters: [discriminatorFilter(name)],
        withContext: true,
        ...(minContextSlot === undefined ? {} : { minContextSlot }),
      },
    ],
  };
}

function addressesOf(result: unknown): { slot: number; addresses: string[] } {
  const { slot, value } = withContext(result);
  if (!Array.isArray(value)) throw new RpcError("shape", "getProgramAccounts did not answer a list");
  const addresses = value.map((item: { pubkey?: unknown }) => {
    if (typeof item?.pubkey !== "string") throw new RpcError("shape", "a program account had no address");
    return item.pubkey;
  });
  return { slot, addresses: addresses.sort() };
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
  counts: Part<Record<AccountName, number>>;
  init: Part<{ found: boolean; slot: number | null; blockTimeMs: number | null; failed: boolean; actions: string[] }>;
}

async function readProgramFactsUncached(): Promise<ProgramFacts> {
  const slots: number[] = [];
  const [program, config, balance, vaultInfo, init, ...counts] = await rpcBatch([
    { method: "getAccountInfo", params: [PINS.programId, { encoding: "base64" }] },
    { method: "getAccountInfo", params: [PINS.accounts.config, { encoding: "base64" }] },
    { method: "getTokenAccountBalance", params: [PINS.accounts.vaultUsdcAccount] },
    { method: "getAccountInfo", params: [PINS.accounts.vaultUsdcAccount, { encoding: "base64" }] },
    {
      method: "getTransaction",
      params: [INIT_TX_SIGNATURE, { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" }],
    },
    ...ACCOUNT_NAMES.map((name) => listAccounts(name)),
  ]);

  // The program account is the one read the page cannot do without.
  const programRead = withContext(unwrap(program));
  slots.push(programRead.slot);
  const programInfo = accountInfo(programRead.value);
  const programData =
    programInfo && programInfo.owner === BPF_UPGRADEABLE_LOADER ? decodeProgramAccount(programInfo.data).programData : null;

  const configPart = part(config, (result) => {
    const { slot, value } = withContext(result);
    slots.push(slot);
    const info = accountInfo(value);
    if (!info) return { exists: false, mint: null, cluster: null, mintMatchesPins: false };
    if (info.owner !== PINS.programId) throw new RpcError("shape", "the config account is not owned by the program");
    const decoded = decodeVaultConfig(info.data);
    return { exists: true, mint: decoded.mint, cluster: decoded.cluster, mintMatchesPins: decoded.mint === PINS.mint };
  });

  const vaultPart = part(balance, (result) => {
    const { slot, value } = withContext(result);
    slots.push(slot);
    const v = value as { amount?: unknown; decimals?: unknown };
    if (typeof v?.amount !== "string" || !/^\d+$/.test(v.amount) || typeof v.decimals !== "number") {
      throw new RpcError("shape", "getTokenAccountBalance answered no amount");
    }
    const info = accountInfo(withContext(unwrap(vaultInfo)).value);
    if (!info) throw new RpcError("shape", "the vault token account does not exist");
    const token = decodeTokenAccount(info.data);
    return {
      amountUnits: v.amount,
      decimals: v.decimals,
      mint: token.mint,
      owner: token.owner,
      mintMatchesPins: token.mint === PINS.mint,
      ownerIsVault: token.owner === PINS.accounts.vault,
    };
  });

  const countsPart: Part<Record<AccountName, number>> = (() => {
    try {
      const out = {} as Record<AccountName, number>;
      ACCOUNT_NAMES.forEach((name, i) => {
        const listed = addressesOf(unwrap(counts[i]));
        slots.push(listed.slot);
        out[name] = listed.addresses.length;
      });
      return { ok: true, value: out };
    } catch (e) {
      return { ok: false, reason: describeFailure(e) };
    }
  })();

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
      const [header] = await rpcBatch([
        {
          method: "getAccountInfo",
          params: [programData, { encoding: "base64", dataSlice: { offset: 0, length: PROGRAM_DATA_HEADER_LEN } }],
        },
      ]);
      const read = withContext(unwrap(header));
      slots.push(read.slot);
      const info = accountInfo(read.value);
      if (!info) throw new RpcError("shape", "the program data account does not exist");
      const decoded = decodeProgramDataHeader(info.data);
      const deploySlot = Number(decoded.slot);
      let deployTimeMs: number | null = null;
      const [blockTime] = await rpcBatch([{ method: "getBlockTime", params: [deploySlot] }]);
      if (blockTime.ok && typeof blockTime.result === "number") deployTimeMs = blockTime.result * 1000;
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

export function readProgramFacts(): Promise<Read<ProgramFacts>> {
  return cachedRead(`program-facts:${PINS.programId}`, REVALIDATE_SECONDS, readProgramFactsUncached);
}

// ---------- proof of reserves (/proof, PLAN.md 3.24) ----------

export interface ReservesRead {
  /** Every balance below was read in one getMultipleAccounts call at this slot. */
  slot: number;
  /** The slots at which the allowance and merchant lists were taken and then checked again. */
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

async function listProgramAccounts(minContextSlot?: number) {
  const [allowances, merchants] = await rpcBatch([
    listAccounts("Allowance", minContextSlot),
    listAccounts("Merchant", minContextSlot),
  ]);
  const a = addressesOf(unwrap(allowances));
  const m = addressesOf(unwrap(merchants));
  return { allowances: a.addresses, merchants: m.addresses, slot: Math.min(a.slot, m.slot) };
}

const sameList = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);

async function readReservesUncached(): Promise<ReservesRead> {
  let listed = await listProgramAccounts();
  // Program accounts are never closed (the program has no close instruction), so if the
  // lists taken again at or after the balances' slot are unchanged, the balances cover
  // every account that existed at that slot. One retry if an account appeared in between.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const addresses = [PINS.accounts.vaultUsdcAccount, ...listed.allowances, ...listed.merchants];
    if (addresses.length - 1 > MAX_ONE_SLOT) {
      throw new Error(
        `the program has ${addresses.length - 1} allowance and merchant accounts; this page reads at most ${MAX_ONE_SLOT} at one slot`,
      );
    }
    const [multiple] = await rpcBatch([{ method: "getMultipleAccounts", params: [addresses, { encoding: "base64" }] }]);
    const { slot, value } = withContext(unwrap(multiple));
    if (!Array.isArray(value) || value.length !== addresses.length) {
      throw new RpcError("shape", "getMultipleAccounts answered the wrong number of accounts");
    }
    let check: Awaited<ReturnType<typeof listProgramAccounts>>;
    try {
      check = await listProgramAccounts(slot);
    } catch (e) {
      // A node behind the balances' slot refuses minContextSlot; ask once more.
      if (e instanceof RpcError && e.kind === "rpc") check = await listProgramAccounts(slot);
      else throw e;
    }
    if (!sameList(check.allowances, listed.allowances) || !sameList(check.merchants, listed.merchants)) {
      listed = check;
      continue;
    }

    const infos = value.map(accountInfo);
    const vaultInfo = infos[0];
    if (!vaultInfo) throw new RpcError("shape", "the vault token account does not exist");
    const token = decodeTokenAccount(vaultInfo.data);
    const allowanceInfos = infos.slice(1, 1 + listed.allowances.length);
    const merchantInfos = infos.slice(1 + listed.allowances.length);
    const allowances = allowanceInfos.map((info, i) => {
      if (!info || info.owner !== PINS.programId) throw new RpcError("shape", `allowance ${listed.allowances[i]} is missing`);
      return decodeAllowance(info.data);
    });
    const merchants = merchantInfos.map((info, i) => {
      if (!info || info.owner !== PINS.programId) throw new RpcError("shape", `merchant ${listed.merchants[i]} is missing`);
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
        address: listed.allowances[i],
        id: a.id.toString(),
        capUnits: a.cap.toString(),
        redeemedUnits: a.redeemed.toString(),
        bondUnits: a.bond.toString(),
        expiry: a.expiry.toString(),
      })),
      merchants: merchants.map((m, i) => ({
        address: listed.merchants[i],
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

export function readReserves(): Promise<Read<ReservesRead>> {
  return cachedRead(`reserves:${PINS.programId}`, REVALIDATE_SECONDS, readReservesUncached);
}
