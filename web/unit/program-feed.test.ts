import { expect, test } from "@playwright/test";
import {
  MAX_ROWS,
  ProgramFeed,
  STALL_AFTER_MS,
  keepNewest,
  loadDetails,
  mergeHistory,
  type Details,
  type FeedClock,
  type Row,
} from "../lib/program-feed";
import { PINS } from "../lib/pins";

// The /live engine's bookkeeping (lib/program-feed.ts). Rows here are TEST FIXTURES with
// made-up signatures; only the fields the bookkeeping reads matter.

function row(signature: string, slot: number | null, details: Details = "read", arrivedLive = false): Row {
  return {
    signature,
    slot,
    blockTime: null,
    failed: false,
    actions: [],
    amounts: [],
    error: null,
    errText: null,
    truncated: false,
    arrivedLive,
    seenAtMs: null,
    details,
  };
}

test.describe("the row cap", () => {
  test("the feed keeps about 100 rows", () => {
    expect(MAX_ROWS).toBe(100);
  });

  test("keeps the newest rows, newest first, and names the dropped oldest ones", () => {
    const rows = Array.from({ length: 105 }, (_, i) => row(`sig-${i + 1}`, i + 1));
    rows.push(row("just-arrived", null, "reading", true));
    const { kept, dropped } = keepNewest(rows, MAX_ROWS);
    expect(kept).toHaveLength(100);
    // A row with no slot yet (just arrived over the socket) is the newest.
    expect(kept[0].signature).toBe("just-arrived");
    expect(kept[1].signature).toBe("sig-105");
    expect(kept[99].signature).toBe("sig-7");
    expect(dropped).toEqual(["sig-6", "sig-5", "sig-4", "sig-3", "sig-2", "sig-1"]);
  });

  test("under the cap nothing is dropped", () => {
    const { kept, dropped } = keepNewest([row("a", 2), row("b", 9)], MAX_ROWS);
    expect(kept.map((r) => r.signature)).toEqual(["b", "a"]);
    expect(dropped).toEqual([]);
  });
});

test.describe("merging a history read", () => {
  const shown = new Map<string, Row>([
    ["read-row", row("read-row", 10, "read")],
    ["unread-row", row("unread-row", 9, "unread")],
    ["unread-live-row", row("unread-live-row", 11, "unread", true)],
  ]);
  const loaded = [row("new-row", 12, "reading"), row("read-row", 10, "reading"), row("unread-row", 9, "reading"), row("unread-live-row", 11, "reading")];

  test("the first read adds new rows and leaves shown rows as they are", () => {
    const changed = mergeHistory(shown, loaded, false);
    expect(changed.map((r) => [r.signature, r.details])).toEqual([["new-row", "reading"]]);
  });

  test("after a reconnect, rows whose details were given up on go back to reading; read rows stay read", () => {
    const changed = mergeHistory(shown, loaded, true);
    expect(changed.map((r) => [r.signature, r.details])).toEqual([
      ["new-row", "reading"],
      ["unread-row", "reading"],
      ["unread-live-row", "reading"],
    ]);
    // A row reset for another try keeps what it had, such as the New mark from the socket.
    expect(changed.find((r) => r.signature === "unread-live-row")?.arrivedLive).toBe(true);
  });
});

// getTransaction answers in one JSON-RPC batch (TEST FIXTURES, answered by a stubbed fetch:
// no request leaves this machine). One answer has the right outer shape but a log line that
// is not a string, which the log parser throws on.
test.describe("reading a batch of transaction details", () => {
  const P = PINS.programId;
  const signatures = Array.from({ length: 8 }, (_, i) => `fixture-sig-${i}`);
  const MALFORMED = "fixture-sig-3";

  function answerFor(signature: string) {
    const ok = {
      slot: 600_000_000 + signatures.indexOf(signature),
      blockTime: 1_791_700_000,
      meta: { err: null, logMessages: [`Program ${P} invoke [1]`, "Program log: Instruction: RedeemNote", `Program ${P} success`] },
      transaction: { signatures: [signature], message: { accountKeys: [P], instructions: [] } },
    };
    return signature === MALFORMED ? { ...ok, meta: { err: null, logMessages: [null] } } : ok;
  }

  test("one malformed answer marks only its own row unavailable; the other seven are read", async () => {
    const realFetch = globalThis.fetch;
    let requests = 0;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requests += 1;
      const calls = JSON.parse(String(init?.body)) as { id: number; params: [string, unknown] }[];
      const body = calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: answerFor(c.params[0]) }));
      return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const outcomes = await loadDetails(signatures, P);
      expect(requests).toBe(1);
      expect(outcomes.map((o) => o.kind)).toEqual(["read", "read", "read", "unavailable", "read", "read", "read", "read"]);
      outcomes.forEach((o, i) => {
        if (o.kind !== "read") return;
        // Each summary belongs to its own signature, in the order asked.
        expect(o.summary.signature).toBe(signatures[i]);
        expect(o.summary.actions).toEqual(["redeem_note"]);
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

// The connection chip says Live only while the socket carries traffic. A FAKE clock drives
// the liveness check, a FAKE WebSocket stands in for devnet's, and a stubbed fetch answers
// the history read: no request leaves this machine.
test.describe("the liveness check", () => {
  const T0 = 1_791_700_000_000;

  class FakeClock implements FeedClock {
    ms = T0;
    private timers: { every: number; next: number; fn: () => void }[] = [];
    now(): number {
      return this.ms;
    }
    every(ms: number, fn: () => void): () => void {
      const timer = { every: ms, next: this.ms + ms, fn };
      this.timers.push(timer);
      return () => {
        this.timers = this.timers.filter((t) => t !== timer);
      };
    }
    /** Moves time forward, firing each repeating timer at every moment it is due. */
    advance(ms: number): void {
      const end = this.ms + ms;
      for (;;) {
        const due = this.timers.filter((t) => t.next <= end).sort((a, b) => a.next - b.next)[0];
        if (!due) break;
        this.ms = due.next;
        due.next += due.every;
        due.fn();
      }
      this.ms = end;
    }
  }

  class FakeSocket {
    static opened: FakeSocket[] = [];
    readonly sent: { id?: number; method?: string }[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      FakeSocket.opened.push(this);
    }
    send(text: string): void {
      this.sent.push(JSON.parse(text));
    }
    close(): void {
      this.onclose?.();
    }
    receive(message: object): void {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  const slot = (n: number) => ({ jsonrpc: "2.0", method: "slotNotification", params: { subscription: 9, result: { slot: n, parent: n - 1, root: n - 2 } } });

  test("Live while slots arrive; No update after the window of silence; Live again when traffic resumes", async () => {
    const realFetch = globalThis.fetch;
    const realWebSocket = globalThis.WebSocket;
    let historyReads = 0;
    globalThis.fetch = (async () => {
      historyReads += 1;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: [] }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    FakeSocket.opened = [];
    globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
    const clock = new FakeClock();
    const feed = new ProgramFeed(PINS.programId, "wss://devnet.fixture.test", clock);
    try {
      feed.start();
      expect(FakeSocket.opened).toHaveLength(1);
      const ws = FakeSocket.opened[0];
      ws.onopen!();
      // The program's logs, and slots as the heartbeat.
      expect(ws.sent.map((m) => m.method)).toEqual(["logsSubscribe", "slotSubscribe"]);
      ws.receive({ jsonrpc: "2.0", id: 1, result: 7 });
      ws.receive({ jsonrpc: "2.0", id: 2, result: 8 });
      expect(feed.getState().connection).toEqual({ kind: "live", sinceMs: T0 });

      // Slots keep arriving for a minute: still live.
      for (let i = 1; i <= 60; i += 1) {
        clock.advance(1000);
        ws.receive(slot(i));
      }
      expect(feed.getState().connection).toEqual({ kind: "live", sinceMs: T0 });

      // The socket goes silent without closing. Exactly at the window it is still live.
      clock.advance(STALL_AFTER_MS);
      expect(feed.getState().connection.kind).toBe("live");
      clock.advance(1000);
      expect(feed.getState().connection).toEqual({ kind: "stalled", sinceMs: T0, silentMs: STALL_AFTER_MS + 1000 });
      clock.advance(5000);
      expect(feed.getState().connection).toEqual({ kind: "stalled", sinceMs: T0, silentMs: STALL_AFTER_MS + 6000 });

      // Traffic resumes: live again at once, and the history is read again.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const readsBefore = historyReads;
      ws.receive(slot(61));
      expect(feed.getState().connection).toEqual({ kind: "live", sinceMs: T0 });
      expect(historyReads).toBe(readsBefore + 1);
      clock.advance(1000);
      expect(feed.getState().connection.kind).toBe("live");

      // A closed socket stops the check: reconnecting is not turned into stalled.
      ws.close();
      clock.advance(STALL_AFTER_MS * 3);
      expect(feed.getState().connection.kind).toBe("reconnecting");
    } finally {
      feed.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
      globalThis.fetch = realFetch;
      globalThis.WebSocket = realWebSocket;
    }
  });
});
