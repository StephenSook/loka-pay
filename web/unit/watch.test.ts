import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { SERIALS_PER_ALLOWANCE, meterOf, readAllowanceAnswer } from "../lib/allowance-read";
import { DEMO_ALLOWANCE_ID } from "../lib/facts";
import { parseProgramLogs } from "../lib/logs";
import { allowanceAddress } from "../lib/pda";
import { WATCH_DEMO_URL } from "../lib/site";
import { PINS } from "../lib/pins";
import { DETAIL_BUDGET, DETAIL_WINDOW_MS, RATE_LIMIT_PAUSE_MS } from "../lib/program-feed";
import { RpcError, fromBase64, type RpcOutcome, type RpcRequest } from "../lib/solana";
import { decodeAllowance } from "../lib/vault";
import {
  AllowanceWatch,
  POLL_MS,
  WATCH_SIGNATURES,
  parseSignatureList,
  redeemAllowancesOf,
  summarizeAllowanceTx,
  type WatchClock,
} from "../lib/watch";
import transactions from "./fixtures/devnet-transactions.json";
import recorded from "./fixtures/devnet-watch.json";

// /watch (PLAN.md 3.85): lib/allowance-read.ts and lib/watch.ts against real devnet answers for
// the demo payer's allowance, recorded in unit/fixtures/devnet-watch.json (its _about says how).
// Where a test needs devnet to answer differently (a rate limit, a later transaction), the
// difference is a labelled TEST FIXTURE built from those recorded answers.

const P = PINS.programId;
const ID = recorded.allowanceId;
const ADDRESS = recorded.address;
const facts = JSON.parse(readFileSync(path.join(__dirname, "..", "..", "docs", "FACTS.json"), "utf8")).facts;

const SETTLED_IPHONE = "2SpG1YURVivMHY3VNWwRsDfo7SZBjWZHXZHeqAovEh6RTNE4XVVNrH5BzU84yJk6nXyqprdHAxt22QSuktskez17";
const REFUSED_IPHONE = "3XtQtnHRKC3QvhBGye8gTMWimPg3iPXuBskf3LMsQEhJPdzeGiqEEjrmjFLqXFTJMQ9JFAitWoCbuEGFSLKjZc9n";
const SETTLED_RUN2 = "5bwtrE78DKhuQiANbY6e3ZceitYqtx85buWnVpPP14y5uLTQGLkWdntGKs3f7itYBMCW1Uqsb3ZoqWGpmGu6fF3T";
const REFUSED_RUN2 = "3uBwo59QKFcXXkGJZRPZw8X8hk6x2Yr2wr69cFDuu6c45wd38N76jBoshsEgbc2SKzAHWssUmfpSf9ACgnnUT6HK";
const OPEN = "3oBQgH9tJGbL9Tvzi4FWmec2Yq8sgeumCXxWQpaLw6RgrgN1baG8xLVCGT4AqNnPstwLLiEC51r2RXEvFFS31YQq";

const txs = recorded.getTransaction as Record<string, { result: unknown }>;
const tx = (signature: string) => txs[signature].result;

test.describe("the recorded fixture", () => {
  test("lists the five transactions on the allowance, newest first, and each one's answer", () => {
    expect(recorded.getSignaturesForAddress.result.map((s) => s.signature)).toEqual([REFUSED_RUN2, SETTLED_RUN2, REFUSED_IPHONE, SETTLED_IPHONE, OPEN]);
    expect(Object.keys(txs).sort()).toEqual([REFUSED_RUN2, SETTLED_RUN2, REFUSED_IPHONE, SETTLED_IPHONE, OPEN].sort());
  });
});

test.describe("the meter", () => {
  test("equals decodeAllowance on the recorded account, read at its slot", () => {
    const answer = recorded.getAccountInfo.result;
    const read = readAllowanceAnswer(answer, P, ID);
    const decoded = decodeAllowance(fromBase64(answer.value.data[0]));
    expect(read).toEqual({ kind: "found", meter: meterOf(decoded, answer.context.slot) });
    // The same values read independently from the bytes when the fixture was recorded.
    expect(read.kind === "found" && read.meter).toEqual({
      id: ID,
      slot: 509688051,
      capUnits: "1000000",
      settledUnits: "500000",
      leftUnits: "500000",
      offlineLimitUnits: "1000000",
      serialsUsed: 2,
      expiry: 1791749841,
      overCap: false,
    });
  });

  test("an account that does not exist is missing, at the slot devnet read", () => {
    expect(readAllowanceAnswer({ context: { slot: 7 }, value: null }, P, ID)).toEqual({ kind: "missing", slot: 7 });
  });

  test("an account the program does not own, another allowance, or bad data is refused, never shown", () => {
    const answer = recorded.getAccountInfo.result;
    expect(() => readAllowanceAnswer({ ...answer, value: { ...answer.value, owner: PINS.mint } }, P, ID)).toThrow("not owned by the program");
    expect(() => readAllowanceAnswer(answer, P, "1")).toThrow(`holds allowance ${ID}, not 1`);
    expect(() => readAllowanceAnswer({ ...answer, value: { ...answer.value, data: ["AAAA", "base64"] } }, P, ID)).toThrow("could not be decoded");
    expect(() => readAllowanceAnswer({ value: null }, P, ID)).toThrow("no context slot");
  });

  test("left is cap minus settled, and an over-cap account says so instead of a negative amount", () => {
    const decoded = decodeAllowance(fromBase64(recorded.getAccountInfo.result.value.data[0]));
    const over = meterOf({ ...decoded, redeemed: decoded.cap + BigInt(1) }, 1);
    expect(over.leftUnits).toBe("0");
    expect(over.overCap).toBe(true);
  });

  test("an allowance has as many serials as docs/FACTS.json says", () => {
    expect(SERIALS_PER_ALLOWANCE).toBe(facts.serials_per_allowance.value);
  });
});

test.describe("one transaction on the allowance", () => {
  test("the settled iPhone payment is paid: 0.25 sandbox USDC, serial 0, from its NoteRedeemed event", () => {
    expect(summarizeAllowanceTx(tx(SETTLED_IPHONE), P, ID, ADDRESS)).toEqual({
      kind: "paid",
      result: "succeeded",
      blockTime: 1791663801,
      amountUnits: "250000",
      serial: 0,
      feeLamports: 10000,
      error: null,
      errorWords: null,
    });
    expect(summarizeAllowanceTx(tx(SETTLED_RUN2), P, ID, ADDRESS)).toMatchObject({ kind: "paid", amountUnits: "250000", serial: 1 });
  });

  test("the iPhone cheat is refused: SerialUsed (6011), named by the program's log line", () => {
    expect(summarizeAllowanceTx(tx(REFUSED_IPHONE), P, ID, ADDRESS)).toEqual({
      kind: "refused",
      result: "failed",
      blockTime: 1791664276,
      amountUnits: null,
      serial: null,
      feeLamports: 10000,
      error: { name: "SerialUsed", number: 6011, message: "This allowance serial was already redeemed" },
      errorWords: null,
    });
    expect(summarizeAllowanceTx(tx(REFUSED_RUN2), P, ID, ADDRESS)).toMatchObject({ kind: "refused", error: { name: "SerialUsed" } });
  });

  test("a refusal whose logs lost the error line is named from its error code, at loka_vault's own instruction 1", () => {
    // TEST FIXTURE: the recorded refusal with the AnchorError log line removed. Its err is
    // InstructionError [1, Custom 6011], and instruction 1 is addressed to loka_vault.
    const raw = tx(REFUSED_IPHONE) as { meta: { logMessages: string[] } };
    const cut = { ...raw, meta: { ...raw.meta, logMessages: raw.meta.logMessages.filter((l) => !l.includes("AnchorError")) } };
    expect(summarizeAllowanceTx(cut, P, ID, ADDRESS)).toMatchObject({ kind: "refused", error: { name: "SerialUsed", number: 6011 }, errorWords: null });
  });

  test("a failure at loka_vault's instruction with no program error is refused, said in words", () => {
    // TEST FIXTURES: the recorded refusal, failing at instruction 1 with a runtime error, then with
    // a code the program does not define, and no AnchorError line.
    const raw = tx(REFUSED_IPHONE) as { meta: { logMessages: string[] } };
    const logs = [`Program ${P} invoke [1]`, "Program log: Instruction: RedeemNote"];
    const runtime = { ...raw, meta: { ...raw.meta, err: { InstructionError: [1, "InvalidAccountData"] }, logMessages: logs } };
    expect(summarizeAllowanceTx(runtime, P, ID, ADDRESS)).toMatchObject({ kind: "refused", error: null, errorWords: "InvalidAccountData at instruction 1." });
    const undefinedCode = { ...raw, meta: { ...raw.meta, err: { InstructionError: [1, { Custom: 3012 }] }, logMessages: logs } };
    expect(summarizeAllowanceTx(undefinedCode, P, ID, ADDRESS)).toMatchObject({
      kind: "refused",
      error: null,
      errorWords: "Error code 3012 at instruction 1, which this program does not define.",
    });
  });

  test("a hand-built transaction whose instruction 0 is another program failing with 6011 is not a refusal, and not SerialUsed", () => {
    // TEST FIXTURE, the attack: instruction 0 is another program that fails with Custom 6011, and
    // instruction 1 is a loka_vault redeem_note (the recorded one's bytes) listing this
    // allowance, so the transaction is on the allowance's signature list. loka_vault never ran.
    const raw = tx(REFUSED_IPHONE) as {
      meta: Record<string, unknown>;
      transaction: { message: { accountKeys: string[]; instructions: Array<Record<string, unknown>> } };
    };
    const OTHER = "Another1111111111111111111111111111111111111";
    const { accountKeys, instructions } = raw.transaction.message;
    const crafted = {
      ...raw,
      meta: {
        ...raw.meta,
        err: { InstructionError: [0, { Custom: 6011 }] },
        logMessages: [`Program ${OTHER} invoke [1]`, `Program ${OTHER} consumed 300 of 400000 compute units`, `Program ${OTHER} failed: custom program error: 0x177b`],
      },
      transaction: {
        ...raw.transaction,
        message: { ...raw.transaction.message, accountKeys: [...accountKeys, OTHER], instructions: [{ ...instructions[0], programIdIndex: accountKeys.length }, instructions[1]] },
      },
    };
    expect(accountKeys[instructions[1].programIdIndex as number]).toBe(P);
    expect(accountKeys).toContain(ADDRESS);
    const summary = summarizeAllowanceTx(crafted, P, ID, ADDRESS);
    expect(summary).toMatchObject({ kind: "other", result: "failed", error: null, errorWords: null });
    expect(JSON.stringify(summary)).not.toContain("SerialUsed");
    // The same with no logs at all.
    expect(summarizeAllowanceTx({ ...crafted, meta: { ...crafted.meta, logMessages: [] } }, P, ID, ADDRESS)).toMatchObject({ kind: "other", error: null });
    // A real redeem_note failing at the precompile (instruction 0): loka_vault never ran either.
    const precompile = { ...raw, meta: { ...raw.meta, err: { InstructionError: [0, { Custom: 2 }] }, logMessages: [] } };
    expect(summarizeAllowanceTx(precompile, P, ID, ADDRESS)).toMatchObject({ kind: "other", error: null });
  });

  test("the open_allowance is not a payment", () => {
    expect(summarizeAllowanceTx(tx(OPEN), P, ID, ADDRESS)).toMatchObject({ kind: "other", amountUnits: null, error: null });
  });

  test("a settled redeem for another allowance is not a payment from this one", async () => {
    // Seen from allowance 1: its redeem_note names this demo allowance's account, not allowance 1's.
    const one = await allowanceAddress(BigInt(1), P);
    expect(summarizeAllowanceTx(tx(SETTLED_IPHONE), P, "1", one)).toMatchObject({ kind: "other", amountUnits: null, serial: null });
    // TEST FIXTURE pairing: a redeem_note naming this account whose complete logs name only another allowance's event.
    expect(summarizeAllowanceTx(tx(SETTLED_IPHONE), P, "1", ADDRESS)).toMatchObject({ kind: "other", amountUnits: null, serial: null });
  });

  test("a settled redeem for this allowance with no NoteRedeemed event to read is paid, amount unknown; one for another allowance is not", async () => {
    // TEST FIXTURES: the recorded payment with its event lines removed, then also with its logs cut short.
    const raw = tx(SETTLED_IPHONE) as { meta: { logMessages: string[] } };
    const noEvent = { ...raw, meta: { ...raw.meta, logMessages: raw.meta.logMessages.filter((l) => !l.startsWith("Program data: ")) } };
    expect(summarizeAllowanceTx(noEvent, P, ID, ADDRESS)).toMatchObject({ kind: "paid", amountUnits: null, serial: null });
    const truncated = { ...noEvent, meta: { ...noEvent.meta, logMessages: [...noEvent.meta.logMessages, "Log truncated"] } };
    expect(summarizeAllowanceTx(truncated, P, ID, ADDRESS)).toMatchObject({ kind: "paid", amountUnits: null, serial: null });
    // Cut-short logs no longer make another allowance's payment look like this one's.
    const one = await allowanceAddress(BigInt(1), P);
    expect(summarizeAllowanceTx(truncated, P, "1", one)).toMatchObject({ kind: "other", amountUnits: null, serial: null });
  });

  test("a spent note replayed for another allowance, with this allowance's address added as an extra account, is not a payment from it", async () => {
    // TEST FIXTURES, the attack: main's recorded refusedRedeem and redeem (unit/fixtures/devnet-transactions.json,
    // real loka_vault transactions for allowance account BcbVk...) with this allowance's address
    // appended to the account keys and to redeem_note's accounts. redeem_note needs no signer and
    // Anchor ignores extra accounts, so anyone can send this, and devnet then lists it on this allowance.
    type Recorded = {
      meta: Record<string, unknown> & { logMessages: string[] };
      transaction: { message: { header: Record<string, number>; accountKeys: string[]; instructions: Array<Record<string, unknown> & { accounts: number[] }> } };
    };
    const replayOf = (recordedTx: unknown, logMessages?: string[]) => {
      const t = recordedTx as Recorded;
      const message = t.transaction.message;
      const [budget, precompile, redeem] = message.instructions;
      return {
        ...t,
        meta: { ...t.meta, logMessages: logMessages ?? t.meta.logMessages },
        transaction: {
          ...t.transaction,
          message: {
            ...message,
            header: { ...message.header, numReadonlyUnsignedAccounts: message.header.numReadonlyUnsignedAccounts + 1 },
            accountKeys: [...message.accountKeys, ADDRESS],
            instructions: [budget, precompile, { ...redeem, accounts: [...redeem.accounts, message.accountKeys.length] }],
          },
        },
      };
    };
    const refused = transactions.refusedRedeem as unknown as Recorded;
    const settled = transactions.redeem as unknown as Recorded;
    // The allowance those recorded redeems are for: its NoteRedeemed event's id, whose address is their accounts[1].
    const event = parseProgramLogs(settled.meta.logMessages, P).events.find((e) => e.kind === "NoteRedeemed");
    if (!event || event.kind !== "NoteRedeemed") throw new Error("the recorded redeem logs no NoteRedeemed event");
    const theirs = await allowanceAddress(event.allowanceId, P);
    expect(theirs).toBe("BcbVkCbBuSogtrxPoFmVrA8kEejjEgbwu5DMCkA4GXVV");
    expect(redeemAllowancesOf(refused, P)).toEqual(new Map([[2, theirs]]));

    // The refused replay: loka_vault's real SerialUsed line is in its logs, and it is not this allowance's refusal.
    const replay = replayOf(refused);
    expect(replay.transaction.message.accountKeys).toContain(ADDRESS);
    expect(redeemAllowancesOf(replay, P)).toEqual(new Map([[2, theirs]]));
    expect(replay.meta.logMessages.some((l) => l.includes("Error Code: SerialUsed"))).toBe(true);
    const summary = summarizeAllowanceTx(replay, P, ID, ADDRESS);
    expect(summary).toMatchObject({ kind: "other", result: "failed", error: null, errorWords: null });
    expect(JSON.stringify(summary)).not.toContain("SerialUsed");
    // Without the AnchorError line its code is at loka_vault's own instruction 2: still not this allowance's.
    const noLine = replayOf(refused, refused.meta.logMessages.filter((l) => !l.includes("AnchorError")));
    expect(summarizeAllowanceTx(noLine, P, ID, ADDRESS)).toMatchObject({ kind: "other", error: null });
    // The settled redeem replayed with its logs cut short (no event to read): not a payment from this allowance.
    const cut = replayOf(settled, [...settled.meta.logMessages.filter((l) => !l.startsWith("Program data: ")), "Log truncated"]);
    expect(summarizeAllowanceTx(cut, P, ID, ADDRESS)).toMatchObject({ kind: "other", amountUnits: null });
    // The refused replay in answers that do not say how it ended (null meta, then no err field): not "Result unknown" here either.
    const noMeta = { ...replay, meta: null };
    const noErr = { ...replay, meta: Object.fromEntries(Object.entries(replay.meta).filter(([key]) => key !== "err")) };
    expect(summarizeAllowanceTx(noMeta, P, ID, ADDRESS)).toMatchObject({ kind: "other", result: "unknown" });
    expect(summarizeAllowanceTx(noErr, P, ID, ADDRESS)).toMatchObject({ kind: "other", result: "unknown" });

    // Controls: for the allowance they name, the same recorded transactions are its refusal and its payment.
    expect(summarizeAllowanceTx(replay, P, event.allowanceId.toString(), theirs)).toMatchObject({ kind: "refused", error: { name: "SerialUsed", number: 6011 } });
    expect(summarizeAllowanceTx(settled, P, event.allowanceId.toString(), theirs)).toMatchObject({ kind: "paid", amountUnits: event.amount.toString() });
    // And the replay whose answer does not say how it ended is a "Result unknown" row for that allowance, as is this allowance's own refusal.
    expect(summarizeAllowanceTx(noMeta, P, event.allowanceId.toString(), theirs)).toMatchObject({ kind: "unknown", result: "unknown" });
    expect(summarizeAllowanceTx(noErr, P, event.allowanceId.toString(), theirs)).toMatchObject({ kind: "unknown", result: "unknown" });
    expect(summarizeAllowanceTx({ ...(tx(REFUSED_IPHONE) as object), meta: null }, P, ID, ADDRESS)).toMatchObject({ kind: "unknown", result: "unknown" });
  });

  test("an answer of the wrong shape is null", () => {
    expect(summarizeAllowanceTx({ slot: 1 }, P, ID, ADDRESS)).toBeNull();
  });
});

test.describe("the signature list", () => {
  test("keeps devnet's order and each result", () => {
    const list = parseSignatureList(recorded.getSignaturesForAddress.result);
    expect(list.map((s) => [s.signature, s.result])).toEqual([
      [REFUSED_RUN2, "failed"],
      [SETTLED_RUN2, "succeeded"],
      [REFUSED_IPHONE, "failed"],
      [SETTLED_IPHONE, "succeeded"],
      [OPEN, "succeeded"],
    ]);
  });

  test("a wrong shape is refused; a missing err is an unknown result", () => {
    expect(() => parseSignatureList({})).toThrow("did not answer a list");
    expect(() => parseSignatureList([{ slot: 1 }])).toThrow("no signature or slot");
    expect(parseSignatureList([{ signature: "x", slot: 1, blockTime: -5 }])).toEqual([{ signature: "x", slot: 1, blockTime: null, result: "unknown" }]);
  });
});

test.describe("the demo allowance", () => {
  test("is the allowance docs/FACTS.json names for both iPhone proof pair transactions", () => {
    expect(ID).toBe(DEMO_ALLOWANCE_ID);
    for (const key of ["proof_pair_iphone_settled_tx", "proof_pair_iphone_refused_tx"]) {
      expect(facts[key].source, key).toContain(`allowance ${DEMO_ALLOWANCE_ID}`);
    }
    expect(WATCH_DEMO_URL).toBe(`https://zerobars.us/watch?a=${DEMO_ALLOWANCE_ID}`);
  });
});

// ---------- the engine, with a fake devnet and a fake clock ----------

class FakeClock implements WatchClock {
  t = 1_791_700_000_000;
  timers: Array<{ at: number; fn: () => void; live: boolean }> = [];
  now() {
    return this.t;
  }
  after(ms: number, fn: () => void) {
    const timer = { at: this.t + ms, fn, live: true };
    this.timers.push(timer);
    return () => {
      timer.live = false;
    };
  }
  pending() {
    return this.timers.filter((t) => t.live).length;
  }
  /** Moves time forward, firing each timer that comes due and letting its round finish. */
  async advance(ms: number) {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.t = due.at;
      due.live = false;
      due.fn();
      await settle();
    }
    this.t = end;
  }
}

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Answers like devnet from the recorded fixture; `list` is which signatures it lists, newest first. */
function fakeDevnet(options: { list: string[]; rateLimitNext?: number }) {
  const sent: RpcRequest[][] = [];
  const state = { ...options };
  const send = async (requests: RpcRequest[]): Promise<RpcOutcome[]> => {
    sent.push(requests);
    if (state.rateLimitNext && state.rateLimitNext > 0) {
      state.rateLimitNext -= 1;
      throw new RpcError("http", "api.devnet.solana.com is rate limiting requests (HTTP 429)", 429);
    }
    return requests.map((r): RpcOutcome => {
      if (r.method === "getAccountInfo") return { ok: true, result: recorded.getAccountInfo.result };
      if (r.method === "getSignaturesForAddress") {
        const all = recorded.getSignaturesForAddress.result;
        // A signature not in the recording is a TEST FIXTURE entry, newer than every recorded one.
        const entry = (s: string, i: number) => all.find((x) => x.signature === s) ?? { signature: s, slot: 600_000_000 - i, err: null, blockTime: null };
        return { ok: true, result: state.list.map(entry) };
      }
      // A transaction not in the recording is answered "not found yet" (null), as devnet does.
      if (r.method === "getTransaction") return { ok: true, result: txs[r.params[0] as string]?.result ?? null };
      return { ok: false, error: new RpcError("rpc", "not in the fixture", -32601) };
    });
  };
  return { send, sent, state };
}

const methods = (requests: RpcRequest[]) => requests.map((r) => r.method);

async function started(list: string[], options: { rateLimitNext?: number } = {}) {
  const devnet = fakeDevnet({ list, ...options });
  const clock = new FakeClock();
  const watch = new AllowanceWatch(ID, P, { send: devnet.send, clock, addressOf: async () => ADDRESS });
  await watch.start();
  await settle();
  return { devnet, clock, watch };
}

test.describe("the engine", () => {
  test("the first round reads the account and the list in one batch, then every transaction in one more", async () => {
    const all = [REFUSED_RUN2, SETTLED_RUN2, REFUSED_IPHONE, SETTLED_IPHONE, OPEN];
    const { devnet, watch } = await started(all);
    expect(devnet.sent).toHaveLength(2);
    expect(methods(devnet.sent[0])).toEqual(["getAccountInfo", "getSignaturesForAddress"]);
    expect(devnet.sent[0][0].params[0]).toBe(ADDRESS);
    expect(devnet.sent[0][1].params).toEqual([ADDRESS, { limit: WATCH_SIGNATURES, commitment: "confirmed" }]);
    expect(devnet.sent[1].map((r) => r.params[0])).toEqual(all);
    const state = watch.getState();
    expect(state.address).toBe(ADDRESS);
    expect(state.polling).toEqual({ kind: "running" });
    expect(state.account.kind === "ok" && state.account.read.kind === "found" && state.account.read.meter.settledUnits).toBe("500000");
    expect(state.entries.map((e) => [e.signature, e.tx?.kind])).toEqual([
      [REFUSED_RUN2, "refused"],
      [SETTLED_RUN2, "paid"],
      [REFUSED_IPHONE, "refused"],
      [SETTLED_IPHONE, "paid"],
      [OPEN, "other"],
    ]);
    expect(state.entries.every((e) => !e.arrivedWhileWatching)).toBe(true);
    expect(state.announcement).toBe("");
    watch.stop();
  });

  test("reads again every POLL_MS; a transaction that lands while watching is marked and announced, and read alone", async () => {
    // TEST FIXTURE: devnet first lists the allowance as it was at 4:23 PM, before the cheat.
    const { devnet, clock, watch } = await started([SETTLED_IPHONE, OPEN]);
    expect(devnet.sent).toHaveLength(2);
    devnet.state.list = [REFUSED_IPHONE, SETTLED_IPHONE, OPEN];
    await clock.advance(POLL_MS);
    expect(devnet.sent).toHaveLength(4);
    expect(methods(devnet.sent[2])).toEqual(["getAccountInfo", "getSignaturesForAddress"]);
    expect(devnet.sent[3].map((r) => r.params[0])).toEqual([REFUSED_IPHONE]);
    const cheat = watch.getState().entries[0];
    expect(cheat.signature).toBe(REFUSED_IPHONE);
    expect(cheat.arrivedWhileWatching).toBe(true);
    expect(cheat.tx?.error?.name).toBe("SerialUsed");
    expect(watch.getState().announcement).toBe("Refused on chain: SerialUsed (6011).");
    // Nothing new: the next round reads the account and the list only.
    await clock.advance(POLL_MS);
    expect(devnet.sent).toHaveLength(5);
    watch.stop();
  });

  test("a hidden page sends nothing, and reads again at once when it is shown", async () => {
    const { devnet, clock, watch } = await started([SETTLED_IPHONE]);
    const before = devnet.sent.length;
    watch.setVisible(false);
    expect(watch.getState().polling).toEqual({ kind: "paused" });
    expect(clock.pending()).toBe(0);
    await clock.advance(10 * POLL_MS);
    expect(devnet.sent).toHaveLength(before);
    watch.setVisible(true);
    await settle();
    expect(devnet.sent).toHaveLength(before + 1);
    expect(watch.getState().polling).toEqual({ kind: "running" });
    watch.stop();
    await clock.advance(10 * POLL_MS);
    expect(devnet.sent).toHaveLength(before + 1);
  });

  test("a rate-limited answer pauses every read for RATE_LIMIT_PAUSE_MS and says so", async () => {
    const { devnet, clock, watch } = await started([SETTLED_IPHONE], { rateLimitNext: 1 });
    expect(devnet.sent).toHaveLength(1);
    const state = watch.getState();
    expect(state.polling).toEqual({ kind: "rate-limited", untilMs: clock.now() + RATE_LIMIT_PAUSE_MS });
    expect(state.account.kind).toBe("failed");
    expect(state.list).toMatchObject({ kind: "failed", reason: "api.devnet.solana.com is rate limiting requests (HTTP 429)" });
    await clock.advance(RATE_LIMIT_PAUSE_MS - 1);
    expect(devnet.sent).toHaveLength(1);
    await clock.advance(1);
    expect(devnet.sent).toHaveLength(3);
    expect(watch.getState().polling).toEqual({ kind: "running" });
    watch.stop();
  });

  test("detail reads share /live's budget: at most DETAIL_BUDGET getTransaction calls in DETAIL_WINDOW_MS", async () => {
    const { devnet, clock, watch } = await started([SETTLED_IPHONE]);
    // TEST FIXTURE: eight more transactions than the budget allows land at once.
    const extra = Array.from({ length: DETAIL_BUDGET }, (_, i) => `extra-${i}`);
    devnet.state.list = [...extra, SETTLED_IPHONE];
    await clock.advance(POLL_MS);
    const detailCalls = () => devnet.sent.flat().filter((r) => r.method === "getTransaction").length;
    // One call in the first round, so seven of the eight fit before the window frees.
    expect(detailCalls()).toBe(DETAIL_BUDGET);
    await clock.advance(DETAIL_WINDOW_MS);
    expect(detailCalls()).toBeGreaterThan(DETAIL_BUDGET);
    watch.stop();
  });

  test("an address that cannot be worked out stops with the reason", async () => {
    const devnet = fakeDevnet({ list: [] });
    const watch = new AllowanceWatch(ID, P, {
      send: devnet.send,
      clock: new FakeClock(),
      addressOf: async () => {
        throw new Error("this browser offers no SHA-256 here (Web Crypto needs an https page)");
      },
    });
    await watch.start();
    expect(watch.getState().polling).toEqual({ kind: "failed", reason: "this browser offers no SHA-256 here (Web Crypto needs an https page)" });
    expect(devnet.sent).toHaveLength(0);
  });
});
