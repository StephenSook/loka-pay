import { expect, test } from "@playwright/test";
import {
  MAX_ROWS,
  ProgramFeed,
  STALL_AFTER_MS,
  keepNewest,
  loadDetails,
  mergeDetails,
  mergeHistory,
  type Details,
  type FeedClock,
  type Row,
} from "../lib/program-feed";
import { summarizeTransaction } from "../lib/logs";
import { PINS } from "../lib/pins";

// The /live engine's bookkeeping (lib/program-feed.ts). Rows here are TEST FIXTURES with
// made-up signatures; only the fields the bookkeeping reads matter.

function row(signature: string, slot: number | null, details: Details = "read", arrivedLive = false): Row {
  return {
    signature,
    slot,
    blockTime: null,
    result: "succeeded",
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

// A row the signature list says failed keeps that result when getTransaction's answer does
// not say how it ended (null metadata): it never becomes a success or an unknown.
test.describe("merging details into a row", () => {
  const P = PINS.programId;
  const failedRow: Row = { ...row("fixture-failed", 70, "reading"), result: "failed", errText: '{"InstructionError":[0,{"Custom":6011}]}' };
  const answer = (meta: unknown) =>
    summarizeTransaction({ slot: 70, blockTime: 1_791_700_000, meta, transaction: { signatures: ["fixture-failed"], message: { accountKeys: [P], instructions: [] } } }, P)!;

  test("an answer with null metadata keeps the known failure and its error text", () => {
    const merged = mergeDetails(failedRow, answer(null));
    expect(merged.result).toBe("failed");
    expect(merged.errText).toBe('{"InstructionError":[0,{"Custom":6011}]}');
    expect(merged.amounts).toEqual([]);
    expect(merged.details).toBe("read");
    expect(merged.blockTime).toBe(1_791_700_000);
  });

  test("an answer that states the result is taken", () => {
    expect(mergeDetails(failedRow, answer({ err: null, logMessages: [] })).result).toBe("succeeded");
    const unknownRow: Row = { ...row("fixture-failed", 70, "reading"), result: "unknown" };
    expect(mergeDetails(unknownRow, answer({ err: { InstructionError: [0, { Custom: 1 }] }, logMessages: [] })).result).toBe("failed");
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

// The connection chip says Live only while the socket carries traffic, and the detail queue
// bounds getTransaction reads. A FAKE clock drives the liveness check and the queue's waits,
// a FAKE WebSocket stands in for devnet's, and a stubbed fetch answers the RPC calls: no
// request leaves this machine.
test.describe("the liveness check", () => {
  const T0 = 1_791_700_000_000;

  class FakeClock implements FeedClock {
    ms = T0;
    private timers: { every: number; next: number; fn: () => void }[] = [];
    private sleepers: { at: number; resolve: () => void }[] = [];
    now(): number {
      return this.ms;
    }
    sleep(ms: number): Promise<void> {
      return new Promise((resolve) => this.sleepers.push({ at: this.ms + ms, resolve }));
    }
    every(ms: number, fn: () => void): () => void {
      const timer = { every: ms, next: this.ms + ms, fn };
      this.timers.push(timer);
      return () => {
        this.timers = this.timers.filter((t) => t !== timer);
      };
    }
    /** Moves time forward, firing each repeating timer at every moment it is due, and each sleep that ends. */
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
      const woken = this.sleepers.filter((w) => w.at <= end);
      this.sleepers = this.sleepers.filter((w) => w.at > end);
      for (const w of woken) w.resolve();
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
    /** A frame exactly as given, which need not be JSON. */
    receiveText(text: string): void {
      this.onmessage?.({ data: text });
    }
  }

  // The node acknowledges logsSubscribe with subscription 7 and slotSubscribe with 8 below, so
  // a slot notification for this socket carries subscription 8.
  const slot = (n: number, subscription = 8) => ({
    jsonrpc: "2.0",
    method: "slotNotification",
    params: { subscription, result: { slot: n, parent: n - 1, root: n - 2 } },
  });

  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

  function withFakes(
    run: (ctx: { clock: FakeClock; feed: ProgramFeed; ws: FakeSocket; historyReads: () => number }) => Promise<void>,
    /** Answers a JSON-RPC batch (getTransaction); the history read always answers an empty list. */
    batch: (calls: { id: number; params: [string, unknown] }[]) => Promise<Response> = async () => json([]),
  ) {
    return async () => {
      const realFetch = globalThis.fetch;
      const realWebSocket = globalThis.WebSocket;
      let reads = 0;
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        if (Array.isArray(body)) return batch(body);
        reads += 1;
        return json({ jsonrpc: "2.0", id: 0, result: [] });
      }) as typeof fetch;
      FakeSocket.opened = [];
      globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
      const clock = new FakeClock();
      const feed = new ProgramFeed(PINS.programId, "wss://devnet.fixture.test", clock);
      try {
        feed.start();
        const ws = FakeSocket.opened[0];
        ws.onopen!();
        ws.receive({ jsonrpc: "2.0", id: 1, result: 7 });
        ws.receive({ jsonrpc: "2.0", id: 2, result: 8 });
        await run({ clock, feed, ws, historyReads: () => reads });
      } finally {
        feed.stop();
        await new Promise((resolve) => setTimeout(resolve, 0));
        globalThis.fetch = realFetch;
        globalThis.WebSocket = realWebSocket;
      }
    };
  }

  test(
    "malformed or foreign frames never restore Live; only a valid message for this socket's subscription does",
    withFakes(async ({ clock, feed, ws, historyReads }) => {
      expect(feed.getState().connection).toEqual({ kind: "live", sinceMs: T0 });
      clock.advance(STALL_AFTER_MS + 1000);
      expect(feed.getState().connection.kind).toBe("stalled");
      await new Promise((resolve) => setTimeout(resolve, 0));
      const readsBefore = historyReads();
      for (const frame of [
        "not json at all",
        "{}",
        "null",
        JSON.stringify({ jsonrpc: "2.0", method: "slotNotification", params: { subscription: 99, result: { slot: 61 } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "slotNotification", params: { subscription: 8, result: { slot: "61" } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "logsNotification", params: { subscription: 8, result: { value: { signature: "x", err: null, logs: [] } } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "logsNotification", params: { subscription: 7, result: { value: { signature: 5, logs: [] } } } }),
        JSON.stringify({ jsonrpc: "2.0", method: "logsNotification", params: { subscription: 7, result: { value: { signature: "x", logs: [null] } } } }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, error: { code: -32601, message: "no" } }),
      ]) {
        ws.receiveText(frame);
        expect(feed.getState().connection.kind, frame).toBe("stalled");
      }
      expect(historyReads()).toBe(readsBefore);
      // A steady stream of junk does not keep a live socket Live either.
      ws.receive(slot(61));
      expect(feed.getState().connection.kind).toBe("live");
      for (let i = 0; i < STALL_AFTER_MS / 1000 + 2; i += 1) {
        clock.advance(1000);
        ws.receiveText("garbage");
      }
      expect(feed.getState().connection.kind).toBe("stalled");
      // A valid slot notification for this subscription restores it.
      ws.receive(slot(62));
      expect(feed.getState().connection.kind).toBe("live");
    }),
  );

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

// The detail queue (lib/program-feed.ts pump): every getTransaction read, for history and
// for transactions that arrive over the socket, shares one request at a time, one budget
// and one rate-limit pause. TEST FIXTURE notifications and answers.
test.describe("the detail queue bounds getTransaction reads", () => {
  const T0 = 1_791_700_000_000;
  const P = PINS.programId;
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  class Clock implements FeedClock {
    ms = T0;
    private sleepers: { at: number; resolve: () => void }[] = [];
    now(): number {
      return this.ms;
    }
    every(): () => void {
      return () => {};
    }
    sleep(ms: number): Promise<void> {
      return new Promise((resolve) => this.sleepers.push({ at: this.ms + ms, resolve }));
    }
    advance(ms: number): void {
      this.ms += ms;
      const woken = this.sleepers.filter((w) => w.at <= this.ms);
      this.sleepers = this.sleepers.filter((w) => w.at > this.ms);
      for (const w of woken) w.resolve();
    }
  }

  class Socket {
    static opened: Socket[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: (() => void) | null = null;
    constructor(readonly url: string) {
      Socket.opened.push(this);
    }
    send(): void {}
    close(): void {
      this.onclose?.();
    }
    receive(message: object): void {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }

  const notification = (signature: string, slot: number) => ({
    jsonrpc: "2.0",
    method: "logsNotification",
    params: { subscription: 7, result: { context: { slot }, value: { signature, err: null, logs: [`Program ${P} invoke [1]`, `Program ${P} success`] } } },
  });

  /** Batches of getTransaction signatures as they were sent, each answered when the test says. */
  async function setup() {
    const realFetch = globalThis.fetch;
    const realWebSocket = globalThis.WebSocket;
    const batches: { signatures: string[]; answer: (r: Response) => void }[] = [];
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      if (!Array.isArray(body)) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: 0, result: [] }), { headers: { "content-type": "application/json" } });
      }
      return new Promise<Response>((answer) => batches.push({ signatures: body.map((c: { params: [string] }) => c.params[0]), answer }));
    }) as typeof fetch;
    Socket.opened = [];
    globalThis.WebSocket = Socket as unknown as typeof WebSocket;
    const clock = new Clock();
    const feed = new ProgramFeed(P, "wss://devnet.fixture.test", clock);
    feed.start();
    const ws = Socket.opened[0];
    ws.onopen!();
    ws.receive({ jsonrpc: "2.0", id: 1, result: 7 });
    await flush();
    const restore = async () => {
      feed.stop();
      await flush();
      globalThis.fetch = realFetch;
      globalThis.WebSocket = realWebSocket;
    };
    return { clock, feed, ws, batches, restore };
  }

  const notFound = (signatures: string[]) =>
    new Response(JSON.stringify(signatures.map((_, id) => ({ jsonrpc: "2.0", id, result: null }))), { headers: { "content-type": "application/json" } });

  test("101 notifications at once: 100 rows, one request in flight at a time, the budget held, the dropped row never asked again", async () => {
    const t = await setup();
    try {
      for (let i = 0; i <= 100; i += 1) t.ws.receive(notification(`burst-${i}`, 600_000_000 + i));
      await flush();
      expect(t.feed.getState().rows).toHaveLength(100);
      // The first arrival started the one request; the other 100 wait for it instead of each
      // starting their own.
      expect(t.batches.map((b) => b.signatures)).toEqual([["burst-0"]]);
      // burst-0, the oldest, was dropped past the cap while its request was out.
      expect(t.feed.getState().rows.map((r) => r.signature)).not.toContain("burst-0");
      t.batches[0].answer(notFound(t.batches[0].signatures));
      await flush();
      // Its answer is discarded, and the next request takes the newest rows within the budget
      // (8 calls per 11 s, one already spent).
      expect(t.batches).toHaveLength(2);
      expect(t.batches[1].signatures).toEqual(Array.from({ length: 7 }, (_, i) => `burst-${100 - i}`));
      t.batches[1].answer(notFound(t.batches[1].signatures));
      await flush();
      // The budget is spent: nothing more is sent until the window frees.
      t.clock.advance(5_000);
      await flush();
      expect(t.batches).toHaveLength(2);
      t.clock.advance(6_000);
      await flush();
      expect(t.batches).toHaveLength(3);
      expect(t.batches[2].signatures).toHaveLength(8);
      for (const b of t.batches.slice(1)) expect(b.signatures).not.toContain("burst-0");
    } finally {
      await t.restore();
    }
  });

  test("a rate-limited answer pauses every detail read; nothing is retried until the pause has passed", async () => {
    const t = await setup();
    try {
      t.ws.receive(notification("limited-1", 600_000_001));
      t.ws.receive(notification("limited-2", 600_000_002));
      await flush();
      expect(t.batches).toHaveLength(1);
      t.batches[0].answer(new Response("Too many requests", { status: 429 }));
      await flush();
      // The budget would allow 6 more calls, and each row's own retry is due after 1.5 s, but
      // the pause holds everything for 11 s.
      t.clock.advance(1_500);
      await flush();
      t.ws.receive(notification("limited-3", 600_000_003));
      await flush();
      t.clock.advance(9_000);
      await flush();
      expect(t.batches).toHaveLength(1);
      t.clock.advance(1_000);
      await flush();
      expect(t.batches).toHaveLength(2);
      expect(t.batches[1].signatures).toEqual(["limited-3", "limited-2", "limited-1"]);
    } finally {
      await t.restore();
    }
  });
});
