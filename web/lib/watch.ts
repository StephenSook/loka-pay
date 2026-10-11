// /watch's engine (PLAN.md 3.85), kept out of React: one allowance, read by the visitor's own
// browser straight from Solana devnet, with no server of ours in the path. A judge opens it on
// their phone and sees each payment from that allowance settle, and a note spent twice refused.
//
// The allowance's address comes from its id (lib/pda.ts, the seeds open.rs uses), so no
// getProgramAccounts scan is needed. Every POLL_MS, while the page is visible, one JSON-RPC batch
// reads the allowance account (getAccountInfo, for the meter) and the newest transactions that
// touch it (getSignaturesForAddress). A transaction not read yet is read with getTransaction
// under the same pacing as /live (lib/program-feed.ts): one batch at a time, at most
// DETAIL_BUDGET calls in any DETAIL_WINDOW_MS, and nothing for RATE_LIMIT_PAUSE_MS after a
// rate-limited answer, which also pauses the poll. While the page is hidden nothing is sent.
//
// A redeem_note is a payment from this allowance only when its allowance account (accounts[1],
// as the IDL and buildRedeemTransaction order them: config, allowance, merchant, instructions
// sysvar) is this allowance's address. redeem_note needs no signer, so anyone can replay a spent
// note for another allowance with this allowance's address added as an extra account (Anchor
// ignores it): that lists the replay on this allowance, and it is not a payment from it.
// A settled redeem_note for this allowance is "paid", with the amount and serial from its
// NoteRedeemed event for this allowance; one whose events name only other allowances is not a
// payment from this one. A failed one is "refused" only when the failing top-level instruction
// is that redeem_note, so loka_vault itself raised the failure (named by its own log line, or by
// its error code, lib/program-errors.ts). A transaction that failed in another program's
// instruction, or for the whole transaction, was not refused by loka_vault, whatever its
// instruction data says. Those and the other transactions on the account (its open_allowance)
// are "other" and are not payments. Nothing is invented while a read is pending or failed: the
// page says what it is waiting for and what failed.

import { readAllowanceAnswer, type AllowanceRead } from "./allowance-read";
import { decodeBase58 } from "./base58";
import { parseProgramLogs, resultOf, summarizeTransaction, type ProgramError, type TxResult } from "./logs";
import { allowanceAddress } from "./pda";
import { DETAIL_ATTEMPTS, DETAIL_BATCH, DETAIL_BUDGET, DETAIL_WINDOW_MS, RATE_LIMIT_PAUSE_MS } from "./program-feed";
import { describeTxError, ownInstructionsOf, programErrorOf, readTxError, type OwnInstructions } from "./program-errors";
import { RpcError, describeFailure, rpcBatch, type RpcOutcome, type RpcRequest } from "./solana";
import { isUnixSeconds } from "./time";
import { formatUnits, instructionNameOf, type VaultEvent } from "./vault";

/** How often the page reads devnet while it is visible. */
export const POLL_MS = 5000;
/** The newest transactions on the allowance that the page reads: one getTransaction batch. */
export const WATCH_SIGNATURES = DETAIL_BATCH;
/** Rows kept while the page stays open, newest first, so an open phone does not grow without limit. */
export const MAX_ENTRIES = 50;

export type EntryKind = "paid" | "refused" | "other" | "unknown";

/** What one transaction did to the allowance, from its getTransaction answer. */
export interface AllowanceTx {
  kind: EntryKind;
  result: TxResult;
  blockTime: number | null;
  /** Paid only: the NoteRedeemed amount for this allowance, mint base units. */
  amountUnits: string | null;
  /** Paid only: the note's serial. */
  serial: number | null;
  /** The network fee devnet charged (meta.fee), in lamports. */
  feeLamports: number | null;
  /** Refused only: the program's error, from its log line or its error code. */
  error: ProgramError | null;
  /** Refused with no program error: plain words for devnet's error field, never raw JSON. */
  errorWords: string | null;
}

interface RawTx {
  meta?: { err?: unknown; fee?: unknown; logMessages?: unknown; loadedAddresses?: { writable?: unknown; readonly?: unknown } | null } | null;
  transaction?: { message?: { accountKeys?: unknown; instructions?: unknown } };
}

const isIndex = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

/**
 * The allowance account each top-level loka_vault redeem_note in a getTransaction answer
 * (encoding "json") names, by instruction index: an instruction addressed to `programId` whose
 * data starts with redeem_note's discriminator, and the key at its accounts[1]. Keys are read as
 * ownInstructionsOf reads them: the static account keys, then the loaded writable and read-only
 * addresses. An instruction whose program, data or accounts cannot be read is left out.
 */
export function redeemAllowancesOf(raw: unknown, programId: string): Map<number, string> {
  const found = new Map<number, string>();
  if (typeof raw !== "object" || raw === null) return found;
  const { meta, transaction } = raw as RawTx;
  const message = transaction?.message;
  if (!isStringList(message?.accountKeys) || !Array.isArray(message.instructions)) return found;
  const loaded = typeof meta === "object" && meta !== null ? meta.loadedAddresses : null;
  const keys = [
    ...message.accountKeys,
    ...(isStringList(loaded?.writable) ? loaded.writable : []),
    ...(isStringList(loaded?.readonly) ? loaded.readonly : []),
  ];
  message.instructions.forEach((ix: unknown, index: number) => {
    if (typeof ix !== "object" || ix === null) return;
    const { programIdIndex, accounts, data } = ix as { programIdIndex?: unknown; accounts?: unknown; data?: unknown };
    if (!isIndex(programIdIndex) || keys[programIdIndex] !== programId) return;
    if (typeof data !== "string" || !Array.isArray(accounts) || !isIndex(accounts[1])) return;
    let bytes: Uint8Array;
    try {
      bytes = decodeBase58(data);
    } catch {
      return;
    }
    const allowance = keys[accounts[1]];
    if (instructionNameOf(bytes) === "redeem_note" && typeof allowance === "string") found.set(index, allowance);
  });
  return found;
}

/** The top-level instruction an `err` field says failed, or null (an error for the whole transaction, or unreadable). */
function failingInstruction(err: unknown, own: OwnInstructions): number | null {
  const reading = readTxError(err, own);
  return reading.kind === "program" || reading.kind === "custom" || reading.kind === "instruction" ? reading.instruction : null;
}

/**
 * One getTransaction answer (encoding json) for a transaction on the allowance at `address`.
 * Null for an answer of the wrong shape. Only a redeem_note whose allowance account is `address`
 * is a payment from this allowance (see above). The amount and serial come only from a settled
 * redeem_note's NoteRedeemed event naming this allowance: a failed transaction moved nothing. A
 * settled one whose complete logs carry NoteRedeemed events, none for this allowance, paid
 * another allowance and is "other"; with no event to read (cut-short logs, or none logged) it is
 * paid, amount unknown. A failed one is "refused" only when its failing top-level instruction is
 * a redeem_note for this allowance.
 */
export function summarizeAllowanceTx(raw: unknown, programId: string, allowanceId: string, address: string): AllowanceTx | null {
  const summary = summarizeTransaction(raw, programId);
  if (!summary) return null;
  const meta = (raw as RawTx).meta;
  const metaObj = typeof meta === "object" && meta !== null ? meta : null;
  const fee = metaObj?.fee;
  const base: AllowanceTx = {
    kind: "other",
    result: summary.result,
    blockTime: summary.blockTime,
    amountUnits: null,
    serial: null,
    feeLamports: typeof fee === "number" && Number.isSafeInteger(fee) && fee >= 0 ? fee : null,
    error: null,
    errorWords: null,
  };
  if (!summary.actions.includes("redeem_note")) return base;
  const redeems = redeemAllowancesOf(raw, programId);
  if (summary.result === "succeeded") {
    // No redeem_note for this allowance's account: listed here only as an extra account.
    if (![...redeems.values()].includes(address)) return base;
    const logs = Array.isArray(metaObj?.logMessages) ? metaObj.logMessages.filter((l): l is string => typeof l === "string") : [];
    const parsed = parseProgramLogs(logs, programId);
    const redeemed = parsed.events.filter((e): e is Extract<VaultEvent, { kind: "NoteRedeemed" }> => e.kind === "NoteRedeemed");
    const event = redeemed.find((e) => e.allowanceId.toString() === allowanceId);
    // Complete logs that name only other allowances: this allowance paid nothing here.
    if (!event && redeemed.length > 0 && !parsed.truncated) return base;
    return {
      ...base,
      kind: "paid",
      amountUnits: event ? event.amount.toString() : null,
      serial: event ? event.serial : null,
    };
  }
  if (summary.result === "failed") {
    const err = metaObj && "err" in metaObj ? metaObj.err : undefined;
    const own = ownInstructionsOf(raw, programId);
    // The failing top-level instruction must be a redeem_note for this allowance. Otherwise
    // loka_vault did not refuse a payment from it: another program failed (loka_vault may never
    // have run), or a redeem_note for another allowance failed with this one as an extra account.
    const failing = failingInstruction(err, own);
    if (failing === null || redeems.get(failing) !== address) return base;
    const error = summary.error ?? programErrorOf(err, own);
    return { ...base, kind: "refused", error, errorWords: error ? null : describeTxError(err, own) };
  }
  return { ...base, kind: "unknown" };
}

export interface SignatureInfo {
  signature: string;
  slot: number;
  blockTime: number | null;
  result: TxResult;
}

/** getSignaturesForAddress's answer, newest first. Throws RpcError on the wrong shape. */
export function parseSignatureList(result: unknown): SignatureInfo[] {
  if (!Array.isArray(result)) throw new RpcError("shape", "getSignaturesForAddress did not answer a list");
  return result.map((item) => {
    const s = item as { signature?: unknown; slot?: unknown; blockTime?: unknown; err?: unknown } | null;
    if (typeof s !== "object" || s === null || typeof s.signature !== "string" || typeof s.slot !== "number") {
      throw new RpcError("shape", "getSignaturesForAddress answered an entry with no signature or slot");
    }
    // A missing err field is an unknown result, never a success.
    return { signature: s.signature, slot: s.slot, blockTime: isUnixSeconds(s.blockTime) ? s.blockTime : null, result: resultOf(s.err) };
  });
}

export type Details = "reading" | "read" | "unread" | "unavailable";

export interface Entry {
  signature: string;
  slot: number;
  blockTime: number | null;
  /** From the signature list until details are read. */
  result: TxResult;
  details: Details;
  /** Null until details are read. */
  tx: AllowanceTx | null;
  /** True when it appeared after this page's first read: it landed while the visitor watched. */
  arrivedWhileWatching: boolean;
}

/** Entries newest first: by slot, then by the order devnet listed them. */
export function sortEntries(entries: Iterable<Entry>, order: ReadonlyMap<string, number>): Entry[] {
  return [...entries].sort((a, b) => b.slot - a.slot || (order.get(a.signature) ?? 0) - (order.get(b.signature) ?? 0));
}

/** The rows a signature list adds: only ones not shown yet, all waiting for their details. */
export function newEntries(current: ReadonlyMap<string, Entry>, list: readonly SignatureInfo[], firstRead: boolean): Entry[] {
  return list
    .filter((s) => !current.has(s.signature))
    .map((s) => ({ ...s, details: "reading" as const, tx: null, arrivedWhileWatching: !firstRead }));
}

export type DetailOutcome =
  | { kind: "read"; tx: AllowanceTx }
  | { kind: "retry"; rateLimited: boolean }
  | { kind: "unread" }
  | { kind: "unavailable" };

/** One getTransaction answer for a row on the allowance at `address`: as lib/program-feed.ts reads them for /live. */
export function detailOutcome(outcome: RpcOutcome, programId: string, allowanceId: string, address: string): DetailOutcome {
  if (!outcome.ok) return outcome.error.code === 429 ? { kind: "retry", rateLimited: true } : { kind: "unread" };
  if (outcome.result === null) return { kind: "retry", rateLimited: false };
  try {
    const tx = summarizeAllowanceTx(outcome.result, programId, allowanceId, address);
    return tx ? { kind: "read", tx } : { kind: "unavailable" };
  } catch {
    return { kind: "unavailable" };
  }
}

export type AccountState =
  | { kind: "loading" }
  | { kind: "ok"; read: AllowanceRead; atMs: number }
  /** The latest read failed; `previous` is the last good one, shown as not current. */
  | { kind: "failed"; atMs: number; reason: string; previous: { read: AllowanceRead; atMs: number } | null };

export type ListState = { kind: "loading" } | { kind: "ok"; atMs: number; count: number } | { kind: "failed"; atMs: number; reason: string };

export type Polling =
  | { kind: "starting" }
  | { kind: "running" }
  /** The page is hidden: nothing is sent until it is visible again. */
  | { kind: "paused" }
  /** Devnet rate limited this browser: nothing is sent until `untilMs`. */
  | { kind: "rate-limited"; untilMs: number }
  /** The allowance's address could not be worked out in this browser. */
  | { kind: "failed"; reason: string };

export interface WatchState {
  address: string | null;
  account: AccountState;
  list: ListState;
  /** Newest first. */
  entries: Entry[];
  polling: Polling;
  /** A sentence for screen readers about the newest payment or refusal. */
  announcement: string;
}

export const INITIAL_WATCH_STATE: WatchState = {
  address: null,
  account: { kind: "loading" },
  list: { kind: "loading" },
  entries: [],
  polling: { kind: "starting" },
  announcement: "",
};

/** The time and timers: the browser's, or a fake one in unit/watch.test.ts. */
export interface WatchClock {
  now(): number;
  /** Calls `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const BROWSER_CLOCK: WatchClock = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
};

export interface WatchDeps {
  /** Sends a JSON-RPC batch: lib/solana.ts rpcBatch against the browser's devnet endpoint. */
  send: (requests: RpcRequest[]) => Promise<RpcOutcome[]>;
  clock: WatchClock;
  /** The allowance account's address for an id. */
  addressOf: (allowanceId: bigint, programId: string) => Promise<string>;
}

const DEFAULT_DEPS: WatchDeps = { send: (requests) => rpcBatch(requests), clock: BROWSER_CLOCK, addressOf: allowanceAddress };

const TX_OPTIONS = { encoding: "json", maxSupportedTransactionVersion: 0, commitment: "confirmed" } as const;

/** The words a screen reader hears when a payment lands while the visitor watches. */
export function announce(tx: AllowanceTx): string {
  if (tx.kind === "paid") return tx.amountUnits ? `Paid: ${formatUnits(tx.amountUnits)} sandbox USDC settled on devnet.` : "Paid: settled on devnet.";
  if (tx.kind === "refused") return tx.error ? `Refused on chain: ${tx.error.name} (${tx.error.number}).` : "Refused on chain.";
  return "";
}

export class AllowanceWatch {
  private state: WatchState = INITIAL_WATCH_STATE;
  private readonly listeners = new Set<(state: WatchState) => void>();
  private readonly entries = new Map<string, Entry>();
  /** Devnet's listing order, so two transactions in one slot keep it. */
  private readonly order = new Map<string, number>();
  private readonly tries = new Map<string, number>();
  private running = false;
  private visible = true;
  private inFlight = false;
  private firstListRead = true;
  private cancel: (() => void) | null = null;
  /** When each getTransaction call of the last DETAIL_WINDOW_MS was sent, oldest first. */
  private sent: number[] = [];
  private pausedUntilMs = 0;
  private readonly deps: WatchDeps;

  constructor(
    private readonly allowanceId: string,
    private readonly programId: string,
    deps: Partial<WatchDeps> = {},
  ) {
    this.deps = { ...DEFAULT_DEPS, ...deps };
  }

  subscribe(listener: (state: WatchState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): WatchState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    let address: string;
    try {
      address = await this.deps.addressOf(BigInt(this.allowanceId), this.programId);
    } catch (e) {
      if (this.running) this.update({ polling: { kind: "failed", reason: describeFailure(e) } });
      return;
    }
    if (!this.running) return;
    this.update({ address });
    await this.tick();
  }

  stop(): void {
    this.running = false;
    this.unschedule();
  }

  /** The page was hidden or shown: polling stops while hidden and reads again at once when shown. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (!this.running || this.state.address === null) return;
    if (!visible) {
      this.unschedule();
      this.update({ polling: { kind: "paused" } });
    } else if (!this.inFlight) {
      void this.tick();
    }
  }

  private update(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  private unschedule(): void {
    this.cancel?.();
    this.cancel = null;
  }

  private schedule(ms: number): void {
    this.unschedule();
    if (!this.running || !this.visible) return;
    this.cancel = this.deps.clock.after(Math.max(ms, 1), () => {
      this.cancel = null;
      void this.tick();
    });
  }

  private publishEntries(patch: Partial<WatchState> = {}): void {
    const sorted = sortEntries(this.entries.values(), this.order);
    for (const dropped of sorted.slice(MAX_ENTRIES)) {
      this.entries.delete(dropped.signature);
      this.order.delete(dropped.signature);
      this.tries.delete(dropped.signature);
    }
    this.update({ ...patch, entries: sorted.slice(0, MAX_ENTRIES) });
  }

  /** One round: the account and the signature list, then details for rows not read yet. */
  async tick(): Promise<void> {
    const address = this.state.address;
    if (!this.running || !this.visible || this.inFlight || address === null) return;
    const now = this.deps.clock.now();
    if (now < this.pausedUntilMs) {
      this.update({ polling: { kind: "rate-limited", untilMs: this.pausedUntilMs } });
      this.schedule(this.pausedUntilMs - now);
      return;
    }
    this.inFlight = true;
    try {
      await this.poll(address);
      // A page hidden during the poll sends nothing more.
      if (this.running && this.visible) await this.readDetails(address);
    } finally {
      this.inFlight = false;
    }
    if (!this.running) return;
    if (!this.visible) {
      this.update({ polling: { kind: "paused" } });
      return;
    }
    const after = this.deps.clock.now();
    if (after < this.pausedUntilMs) {
      this.update({ polling: { kind: "rate-limited", untilMs: this.pausedUntilMs } });
      this.schedule(this.pausedUntilMs - after);
    } else {
      this.update({ polling: { kind: "running" } });
      this.schedule(POLL_MS);
    }
  }

  private failAccount(atMs: number, reason: string): AccountState {
    const a = this.state.account;
    const previous = a.kind === "ok" ? { read: a.read, atMs: a.atMs } : a.kind === "failed" ? a.previous : null;
    return { kind: "failed", atMs, reason, previous };
  }

  private async poll(address: string): Promise<void> {
    let outcomes: RpcOutcome[];
    try {
      outcomes = await this.deps.send([
        { method: "getAccountInfo", params: [address, { encoding: "base64", commitment: "confirmed" }] },
        { method: "getSignaturesForAddress", params: [address, { limit: WATCH_SIGNATURES, commitment: "confirmed" }] },
      ]);
    } catch (e) {
      const atMs = this.deps.clock.now();
      if (e instanceof RpcError && e.code === 429) this.pausedUntilMs = atMs + RATE_LIMIT_PAUSE_MS;
      const reason = describeFailure(e);
      if (this.running) this.update({ account: this.failAccount(atMs, reason), list: { kind: "failed", atMs, reason } });
      return;
    }
    if (!this.running) return;
    const atMs = this.deps.clock.now();
    const [accountOutcome, listOutcome] = outcomes;
    if ([accountOutcome, listOutcome].some((o) => !o.ok && o.error.code === 429)) this.pausedUntilMs = atMs + RATE_LIMIT_PAUSE_MS;

    let account: AccountState;
    try {
      if (!accountOutcome.ok) throw accountOutcome.error;
      account = { kind: "ok", read: readAllowanceAnswer(accountOutcome.result, this.programId, this.allowanceId), atMs };
    } catch (e) {
      account = this.failAccount(atMs, describeFailure(e));
    }

    let list: ListState;
    try {
      if (!listOutcome.ok) throw listOutcome.error;
      const signatures = parseSignatureList(listOutcome.result);
      // Devnet lists newest first; within one slot the latest list's order is kept.
      signatures.forEach((s, i) => this.order.set(s.signature, i));
      for (const entry of newEntries(this.entries, signatures, this.firstListRead)) this.entries.set(entry.signature, entry);
      this.firstListRead = false;
      list = { kind: "ok", atMs, count: signatures.length };
    } catch (e) {
      list = { kind: "failed", atMs, reason: describeFailure(e) };
    }
    this.publishEntries({ account, list });
  }

  private async readDetails(address: string): Promise<void> {
    const now = this.deps.clock.now();
    if (now < this.pausedUntilMs) return;
    this.sent = this.sent.filter((t) => now - t < DETAIL_WINDOW_MS);
    const budget = DETAIL_BUDGET - this.sent.length;
    const waiting = sortEntries(this.entries.values(), this.order).filter((e) => e.details === "reading");
    if (budget <= 0 || waiting.length === 0) return;
    const batch = waiting.slice(0, Math.min(DETAIL_BATCH, budget));
    for (let i = 0; i < batch.length; i += 1) this.sent.push(now);
    let outcomes: DetailOutcome[];
    try {
      const answers = await this.deps.send(batch.map((e) => ({ method: "getTransaction", params: [e.signature, TX_OPTIONS] })));
      outcomes = answers.map((a) => detailOutcome(a, this.programId, this.allowanceId, address));
    } catch (e) {
      const rateLimited = e instanceof RpcError && e.code === 429;
      outcomes = batch.map((): DetailOutcome => ({ kind: "retry", rateLimited }));
    }
    if (!this.running) return;
    const atMs = this.deps.clock.now();
    let announcement = this.state.announcement;
    batch.forEach((entry, i) => {
      const outcome = outcomes[i];
      const current = this.entries.get(entry.signature);
      if (!current) return;
      if (outcome.kind === "read") {
        const tx = outcome.tx;
        this.entries.set(entry.signature, {
          ...current,
          details: "read",
          tx,
          blockTime: tx.blockTime ?? current.blockTime,
          // An answer that does not say how it ended keeps what the list said.
          result: tx.result === "unknown" ? current.result : tx.result,
        });
        this.tries.delete(entry.signature);
        if (current.arrivedWhileWatching) announcement = announce(tx) || announcement;
      } else if (outcome.kind === "unread" || outcome.kind === "unavailable") {
        this.entries.set(entry.signature, { ...current, details: outcome.kind });
        this.tries.delete(entry.signature);
      } else {
        if (outcome.rateLimited) this.pausedUntilMs = atMs + RATE_LIMIT_PAUSE_MS;
        const tries = (this.tries.get(entry.signature) ?? 0) + 1;
        if (tries >= DETAIL_ATTEMPTS) {
          this.entries.set(entry.signature, { ...current, details: "unread" });
          this.tries.delete(entry.signature);
        } else {
          this.tries.set(entry.signature, tries);
        }
      }
    });
    this.publishEntries({ announcement });
  }
}
