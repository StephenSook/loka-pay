// Which settled payment the phone call reads out (PLAN.md 3.9). Server only. Every answer comes
// from devnet through the server's RPC endpoint (lib/server-rpc.ts), and it is decoded with the
// same log parser as /live and /judge (lib/logs.ts). A transaction counts only when devnet
// says it succeeded (meta.err null), it names our program (config/pins.json), and our
// program's own logs show redeem_note with a NoteRedeemed event carrying an amount. A refused
// or failed transaction is never read out as paid: its events were rolled back.

import { parseProgramLogs, summarizeTransaction } from "./logs";
import { RpcError, explorerTx, rpc, rpcBatch, type RpcOptions } from "./solana";

export interface SettledPayment {
  signature: string;
  /** The sum of the transaction's NoteRedeemed amounts, in mint base units. */
  amountUnits: string;
  /** Block time, Unix seconds. */
  blockTime: number;
  explorer: string;
}

/** How many of the program's latest signatures are listed when no signature is given. */
export const LATEST_SIGNATURES = 25;
/**
 * At most this many transactions are read in full per request, in one batch: public devnet
 * allows 10 getTransaction calls per 10 s per IP, and /live's queue keeps under that too.
 */
export const LATEST_DETAIL_READS = 8;

const TX_OPTIONS = { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" } as const;

/** Every account key the transaction names, including those loaded from lookup tables. */
function accountKeys(tx: unknown): string[] {
  const t = tx as {
    transaction?: { message?: { accountKeys?: unknown } };
    meta?: { loadedAddresses?: { writable?: unknown; readonly?: unknown } } | null;
  };
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string") : []);
  return [
    ...list(t.transaction?.message?.accountKeys),
    ...list(t.meta?.loadedAddresses?.writable),
    ...list(t.meta?.loadedAddresses?.readonly),
  ];
}

/**
 * A getTransaction answer (encoding json) as a settled payment, or null when it is not one:
 * the wrong shape, not succeeded, not naming our program, no redeem_note from our program,
 * no NoteRedeemed amount, or no block time to say how long ago it was.
 */
export function settlementOf(tx: unknown, programId: string): SettledPayment | null {
  const summary = summarizeTransaction(tx, programId);
  if (summary === null || summary.result !== "succeeded" || summary.blockTime === null) return null;
  if (!accountKeys(tx).includes(programId)) return null;
  const logs = (tx as { meta?: { logMessages?: unknown } | null }).meta?.logMessages;
  if (!Array.isArray(logs) || !logs.every((l) => typeof l === "string")) return null;
  const parsed = parseProgramLogs(logs, programId);
  if (!parsed.instructions.includes("redeem_note")) return null;
  let total = BigInt(0);
  let found = false;
  for (const event of parsed.events) {
    if (event.kind !== "NoteRedeemed") continue;
    total += event.amount;
    found = true;
  }
  if (!found || total <= BigInt(0)) return null;
  return { signature: summary.signature, amountUnits: total.toString(), blockTime: summary.blockTime, explorer: explorerTx(summary.signature) };
}

/** The settled payment a signature names, or null when devnet has no settled payment under it. */
export async function settlementBySignature(signature: string, programId: string, options: RpcOptions): Promise<SettledPayment | null> {
  const tx = await rpc("getTransaction", [signature, TX_OPTIONS], options);
  if (tx === null) return null;
  const payment = settlementOf(tx, programId);
  // The answer must be the transaction asked for.
  return payment !== null && payment.signature === signature ? payment : null;
}

/**
 * The program's newest settled payment: its latest LATEST_SIGNATURES signatures, failed ones
 * skipped, then the newest LATEST_DETAIL_READS of the rest read in one batch, newest first.
 * A read that failed before a settlement was found throws, so a failure is never reported as
 * "no settled payment" and an older payment is never read out in place of one that could not
 * be read.
 */
export async function latestSettlement(programId: string, options: RpcOptions): Promise<SettledPayment | null> {
  const listed = await rpc("getSignaturesForAddress", [programId, { limit: LATEST_SIGNATURES, commitment: "confirmed" }], options);
  if (!Array.isArray(listed)) throw new RpcError("shape", "getSignaturesForAddress did not answer a list");
  const candidates: string[] = [];
  for (const item of listed as Array<{ signature?: unknown; err?: unknown }>) {
    if (typeof item?.signature !== "string") throw new RpcError("shape", "getSignaturesForAddress answered an entry with no signature");
    // Only a transaction devnet says succeeded; a missing err field is not a success.
    if ("err" in item && item.err === null) candidates.push(item.signature);
    if (candidates.length === LATEST_DETAIL_READS) break;
  }
  if (candidates.length === 0) return null;
  const outcomes = await rpcBatch(
    candidates.map((s) => ({ method: "getTransaction", params: [s, TX_OPTIONS] })),
    options,
  );
  for (let i = 0; i < candidates.length; i += 1) {
    const outcome = outcomes[i];
    if (!outcome.ok) throw outcome.error;
    // Not visible at this commitment yet: nothing to say about it.
    if (outcome.result === null) continue;
    const payment = settlementOf(outcome.result, programId);
    if (payment !== null && payment.signature === candidates[i]) return payment;
  }
  return null;
}
