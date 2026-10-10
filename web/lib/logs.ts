// Reads a transaction's log lines (from getTransaction or a logsSubscribe notification) and
// its instruction data (getTransaction only) into what /live and /judge show: which
// loka_vault instructions ran, the amounts their events carry, and the program's named
// error when one failed. Pure functions, unit-tested in unit/logs.test.ts.
//
// Log lines name the program that wrote them only through the call stack: "Program <id>
// invoke [n]" opens a frame and "Program <id> success" or "failed" closes it. A line such
// as "Program log: Instruction: TransferChecked" inside loka_vault's frame comes from the
// token program it called, so every line is attributed to the frame on top of the stack.

import { decodeBase58 } from "./base58";
import { fromBase64 } from "./solana";
import {
  BPF_UPGRADEABLE_LOADER,
  decodeEvent,
  decodeLoaderInstruction,
  decodeOpenAllowanceArgs,
  instructionNameOf,
  snakeCase,
  type VaultEvent,
} from "./vault";

export interface ProgramError {
  /** Anchor's error name, for example "SerialUsed". */
  name: string;
  /** Anchor's error number, for example 6011. */
  number: number;
  message: string;
}

export interface ParsedLogs {
  /** loka_vault instruction names in the order they ran, snake_case ("redeem_note"). */
  instructions: string[];
  events: VaultEvent[];
  error: ProgramError | null;
  /** "deployed" or "upgraded" when the loader logged it for this program. */
  loader: "deployed" | "upgraded" | null;
  /** True when the node cut the logs short ("Log truncated"). */
  truncated: boolean;
}

const INVOKE = /^Program (\S+) invoke \[(\d+)\]$/;
const SUCCESS = /^Program (\S+) success$/;
const FAILED = /^Program (\S+) failed: /;
const LOG = /^Program log: (.*)$/;
const DATA = /^Program data: (.*)$/;
const INSTRUCTION = /^Instruction: ([A-Za-z0-9_]+)$/;
const ANCHOR_ERROR = /Error Code: ([A-Za-z0-9_]+)\. Error Number: (\d+)\. Error Message: (.*?)\.?$/;
const LOADER_LINE = /^(Deployed|Upgraded) program (\S+)$/;

export function parseProgramLogs(logs: readonly string[], programId: string): ParsedLogs {
  const stack: string[] = [];
  const out: ParsedLogs = { instructions: [], events: [], error: null, loader: null, truncated: false };
  // Whether the current loka_vault frame already logged its instruction name.
  const named: boolean[] = [];
  for (const line of logs) {
    const top = stack[stack.length - 1];
    let m: RegExpMatchArray | null;
    if ((m = line.match(INVOKE))) {
      stack.push(m[1]);
      named.push(false);
    } else if ((m = line.match(SUCCESS)) || (m = line.match(FAILED))) {
      // Pop the matching frame; a mismatch means the logs were cut, so drop to it if present.
      const at = stack.lastIndexOf(m[1]);
      if (at >= 0) {
        stack.length = at;
        named.length = at;
      }
    } else if ((m = line.match(LOG))) {
      if (top !== programId) continue;
      const text = m[1];
      const ix = text.match(INSTRUCTION);
      if (ix && !named[named.length - 1]) {
        out.instructions.push(snakeCase(ix[1]));
        named[named.length - 1] = true;
        continue;
      }
      const err = text.match(ANCHOR_ERROR);
      if (err && out.error === null) out.error = { name: err[1], number: Number(err[2]), message: err[3] };
    } else if ((m = line.match(DATA))) {
      if (top !== programId) continue;
      for (const part of m[1].split(" ")) {
        try {
          const event = decodeEvent(fromBase64(part));
          if (event) out.events.push(event);
        } catch {
          // Not base64 or a cut-short event: not one of ours to show.
        }
      }
    } else if ((m = line.match(LOADER_LINE))) {
      if (top === BPF_UPGRADEABLE_LOADER && m[2] === programId) {
        out.loader = m[1] === "Deployed" ? "deployed" : "upgraded";
      }
    } else if (line === "Log truncated") {
      out.truncated = true;
    }
  }
  return out;
}

export interface Amount {
  label: string;
  /** Mint base units as a decimal string. */
  units: string;
}

export interface TxSummary {
  signature: string;
  slot: number | null;
  /** Unix seconds, or null when not known yet (a notification carries none). */
  blockTime: number | null;
  failed: boolean;
  /** What ran, for the row title: loka_vault instructions, or a loader action. */
  actions: string[];
  amounts: Amount[];
  error: ProgramError | null;
  /** The transaction error object as the node sent it, as text, when failed. */
  errText: string | null;
  truncated: boolean;
}

function amountsFromEvents(events: VaultEvent[]): Amount[] {
  return events.map((e) =>
    e.kind === "NoteRedeemed"
      ? { label: "Note redeemed", units: e.amount.toString() }
      : { label: "Withdrawn", units: e.amount.toString() },
  );
}

/** A summary from log lines alone (a logsSubscribe notification). */
export function summarizeLogs(
  signature: string,
  slot: number | null,
  err: unknown,
  logs: readonly string[],
  programId: string,
): TxSummary {
  const parsed = parseProgramLogs(logs, programId);
  const actions = [...parsed.instructions];
  if (parsed.loader) actions.push(parsed.loader === "deployed" ? "program deployed" : "program upgraded");
  return {
    signature,
    slot,
    blockTime: null,
    failed: err !== null && err !== undefined,
    actions,
    amounts: amountsFromEvents(parsed.events),
    error: parsed.error,
    errText: err === null || err === undefined ? null : JSON.stringify(err),
    truncated: parsed.truncated,
  };
}

interface RawInstruction {
  programIdIndex: number;
  accounts: number[];
  data: string;
}

interface RawTransaction {
  slot: number;
  blockTime: number | null;
  meta: { err: unknown; logMessages?: string[] | null; loadedAddresses?: { writable?: string[]; readonly?: string[] } } | null;
  transaction: { signatures: string[]; message: { accountKeys: string[]; instructions: RawInstruction[] } };
}

function isRawTransaction(value: unknown): value is RawTransaction {
  const t = value as RawTransaction | null;
  return (
    typeof t === "object" &&
    t !== null &&
    typeof t.slot === "number" &&
    Array.isArray(t.transaction?.message?.accountKeys) &&
    Array.isArray(t.transaction?.message?.instructions) &&
    Array.isArray(t.transaction?.signatures)
  );
}

/**
 * A summary from a getTransaction answer (encoding "json"). Adds what logs do not carry:
 * the amount an open_allowance deposits (cap + bond, from its instruction data) and the
 * loader instruction behind a deploy. Returns null for an answer of the wrong shape.
 */
export function summarizeTransaction(value: unknown, programId: string): TxSummary | null {
  if (!isRawTransaction(value)) return null;
  const { transaction, meta } = value;
  const signature = transaction.signatures[0];
  const base = summarizeLogs(signature, value.slot, meta?.err ?? null, meta?.logMessages ?? [], programId);
  base.blockTime = value.blockTime ?? null;
  const keys = [
    ...transaction.message.accountKeys,
    ...(meta?.loadedAddresses?.writable ?? []),
    ...(meta?.loadedAddresses?.readonly ?? []),
  ];
  const fromData: string[] = [];
  for (const ix of transaction.message.instructions) {
    const program = keys[ix.programIdIndex];
    let data: Uint8Array;
    try {
      data = decodeBase58(ix.data);
    } catch {
      continue;
    }
    if (program === programId) {
      const name = instructionNameOf(data);
      if (name) fromData.push(name);
      if (name === "open_allowance") {
        try {
          const args = decodeOpenAllowanceArgs(data);
          base.amounts.push({ label: "Deposited (cap + bond)", units: (args.cap + args.bond).toString() });
        } catch {
          // Malformed data: the program would have refused it; show no amount.
        }
      }
    } else if (program === BPF_UPGRADEABLE_LOADER && ix.accounts.some((i) => keys[i] === programId)) {
      try {
        fromData.push(`loader: ${decodeLoaderInstruction(data)}`);
      } catch {
        // Too short to carry a tag.
      }
    }
  }
  // Logs are the record of what ran; instruction data fills in when logs were cut short
  // or name nothing (a top-level call that failed before logging its name).
  // The loader instruction (DeployWithMaxDataLen, Upgrade, SetAuthority) is shown unless
  // the logs already said "Deployed program" or "Upgraded program".
  const loaderLogged = base.actions.some((a) => a === "program deployed" || a === "program upgraded");
  const fill = base.actions.length === 0 || base.truncated;
  for (const name of fromData) {
    if (base.actions.includes(name)) continue;
    if (name.startsWith("loader: ") ? !loaderLogged : fill) {
      base.actions.push(name);
    }
  }
  return base;
}
